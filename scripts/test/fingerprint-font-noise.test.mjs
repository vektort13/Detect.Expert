// ADR-110 addendum (2026-11-07, owner decision): deterministic noise of GENERATED Windows font lists. About 3 % of the optional names are left out, chosen by
// the profile's random seed; the same seed gives the same list; mandatory families are never left out; the contract of the Custom row is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiConfiguration, validateApiValue, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { describeDevice, fontValues, buildDeviceValues } from '../../apps/production-extension/fingerprint-device-presets.js';
import { windowsFonts, WINDOWS_FONT_GROUPS, REGION_FONT_GROUP_KEYS, regionFontRoots } from '../../apps/production-extension/fingerprint-font-groups.js';
import { hiddenFontNames } from '../../apps/production-extension/font-probe-names.js';
import { FONT_NOISE_MANDATORY, FONT_NOISE_SHARE, FONT_NOISE_MIN, FONT_NOISE_FLOOR_FROM, FONT_NOISE_VERSION, fontNoiseModel, fontNoiseHidden, noisyFontList, removedByNoise, noiseSeedFromNames, followFontNoise } from '../../apps/production-extension/fingerprint-font-noise.js';

const base = createApiConfiguration();
const lower = name => name.toLowerCase();
const seedAt = index => (Math.imul(index + 1, 2654435761) ^ 0x5bd1e995) >>> 0;
const COMBOS = [false, true].flatMap(windows11 => [false, true].flatMap(office => [false, true].map(panEuropean => ({ windows11, office, panEuropean }))));
const label = groups => JSON.stringify(groups);
const families = configuration => configuration.apis.find(row => row.id === 'canvas-font-policy').selected.value?.families;
const valueOf = configuration => id => { const row = configuration.apis.find(item => item.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const strict = (seed, extra = {}) => generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed, ...extra });
const withFonts = (configuration, list) => { const result = updateApiConfiguration(configuration, 'canvas-font-policy', { mode: 'custom', selected: { kind: 'value', value: { families: list, fallback: 'sans-serif' } } }); assert.equal(result.ok, true, result.error?.message); return result.value; };

test('the mandatory set: frozen, unique, ASCII, every root is a Windows family or platform alias, the owner\'s examples and the Windows tells are in', () => {
  assert.equal(FONT_NOISE_VERSION, 1); assert.equal(FONT_NOISE_SHARE, 0.03);
  assert.ok(Object.isFrozen(FONT_NOISE_MANDATORY));
  assert.equal(new Set(FONT_NOISE_MANDATORY.map(lower)).size, FONT_NOISE_MANDATORY.length, 'no root twice');
  const everything = new Set(windowsFonts({ windows11: true, office: true, panEuropean: true }).map(lower));
  for (const name of FONT_NOISE_MANDATORY) { assert.ok(/^[\x20-\x7e]+$/u.test(name) && name === name.trim(), name); assert.ok(everything.has(lower(name)), name + ' is a name of the Windows lists'); }
  for (const name of ['Arial', 'Times New Roman', 'Courier New', 'Segoe UI', 'Tahoma', 'Verdana', 'Georgia', 'Calibri', 'Consolas', 'Cambria', 'Trebuchet MS']) assert.ok(FONT_NOISE_MANDATORY.includes(name), 'the owner named ' + name);
  for (const name of ['Segoe UI', 'Marlett', 'MS UI Gothic', 'Franklin Gothic Medium', 'Consolas', 'Courier New', 'Calibri']) assert.ok(FONT_NOISE_MANDATORY.includes(name), 'a tell of a Windows list: ' + name);
  for (const name of ['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times']) assert.ok(FONT_NOISE_MANDATORY.includes(name), 'a platform alias: ' + name);
  assert.ok(FONT_NOISE_MANDATORY.length <= 32, 'a small set');
});

test('units: a name with the names that continue it after a space; the limit is round(3 % of the optional names); the numbers of every claimable list', () => {
  const expected = { '{"windows11":false,"office":false,"panEuropean":false}': [96, 39, 57, 2], '{"windows11":false,"office":false,"panEuropean":true}': [102, 42, 60, 2], '{"windows11":false,"office":true,"panEuropean":false}': [211, 39, 172, 5], '{"windows11":false,"office":true,"panEuropean":true}': [217, 42, 175, 5],
    '{"windows11":true,"office":false,"panEuropean":false}': [102, 43, 59, 2], '{"windows11":true,"office":false,"panEuropean":true}': [108, 46, 62, 2], '{"windows11":true,"office":true,"panEuropean":false}': [217, 43, 174, 5], '{"windows11":true,"office":true,"panEuropean":true}': [223, 46, 177, 5] };
  for (const groups of COMBOS) {
    const list = windowsFonts(groups), model = fontNoiseModel(list), names = model.units.flatMap(unit => unit.names);
    assert.deepEqual([...names].sort(), [...list].sort(), label(groups) + ': the units partition the list');
    for (const unit of model.units) {
      assert.ok(unit.names.includes(unit.root) && lower(unit.root) === unit.key, unit.root);
      for (const name of unit.names) if (name !== unit.root) assert.ok(lower(name).startsWith(unit.key + ' '), name + ' continues ' + unit.root);
    }
    const locked = model.units.filter(unit => unit.locked).reduce((sum, unit) => sum + unit.names.length, 0);
    assert.equal(model.optional, list.length - locked); assert.equal(model.limit, Math.round(model.optional * 0.03));
    assert.deepEqual([list.length, locked, model.optional, model.limit], expected[label(groups)], label(groups));
    assert.ok(model.limit / model.optional >= 0.025 && model.limit / model.optional <= 0.036, label(groups) + ': about 3 % (' + (100 * model.limit / model.optional).toFixed(2) + ' %)');
  }
  // The families that go together: weight variants and the Segoe UI family are one unit; a mandatory root locks its whole unit.
  const core = fontNoiseModel(windowsFonts()), unit = name => core.units.find(entry => entry.names.includes(name));
  assert.deepEqual(unit('Candara Light').names, ['Candara', 'Candara Light']); assert.equal(unit('Candara').locked, false);
  assert.deepEqual(unit('Arial Black').names, ['Arial', 'Arial Black']); assert.equal(unit('Arial').locked, true);
  assert.deepEqual(unit('Times New Roman').names, ['Times', 'Times New Roman']); assert.deepEqual(unit('Courier New').names, ['Courier', 'Courier New']);
  assert.equal(unit('Segoe UI Semibold').names.length, 8); assert.ok(unit('Segoe UI Semibold').locked && unit('Segoe UI Symbol').locked && unit('Segoe UI Emoji').locked);
  assert.equal(unit('Yu Gothic UI Light').names.length, 7); assert.equal(unit('Microsoft YaHei UI').names.length, 4);
  assert.ok(fontNoiseModel(windowsFonts({ windows11: true })).units.find(entry => entry.names.includes('Segoe UI Variable Text')).locked, 'the Windows 11 UI font continues Segoe UI');
  assert.ok(fontNoiseModel(windowsFonts({ panEuropean: true })).units.find(entry => entry.names.includes('Georgia Pro')).locked, 'Georgia Pro continues Georgia');
  // A variant of a mandatory family is mandatory even when the list does not hold the root.
  assert.equal(fontNoiseModel(['Segoe UI Light', 'Zz Own']).units.find(entry => entry.names.includes('Segoe UI Light')).locked, true);
  assert.equal(fontNoiseModel(['Zz Own', 'Zz Own Bold']).units.length, 1);
  // Foreign input is tolerated: no throw, nothing to leave out.
  for (const junk of [undefined, null, 'Arial', 7, {}, [], [1, null, {}], new Array(600).fill('A')]) assert.equal(fontNoiseModel(junk).limit, 0);
});

test('a seed leaves out exactly the limit of whole optional units: never a mandatory name, list order kept, the same seed gives the same list', () => {
  for (const groups of COMBOS) {
    const list = windowsFonts(groups), model = fontNoiseModel(list), lockedNames = new Set(model.units.filter(unit => unit.locked).flatMap(unit => unit.names)), unitOf = new Map(model.units.flatMap(unit => unit.names.map(name => [name, unit])));
    const runs = groups.office ? 40 : 250;
    for (let index = 0; index < runs; index++) {
      const seed = seedAt(index), hidden = fontNoiseHidden(list, seed);
      assert.equal(hidden.length, model.limit, label(groups) + ' seed ' + seed + ': exactly the limit');
      assert.deepEqual(hidden, [...hidden].sort((a, b) => list.indexOf(a) - list.indexOf(b)), 'in list order');
      for (const name of hidden) { assert.ok(!lockedNames.has(name), name + ' is mandatory'); const unit = unitOf.get(name); assert.ok(unit.names.every(member => hidden.includes(member)), name + ': its whole family goes'); }
      const noisy = noisyFontList(list, seed);
      assert.equal(noisy.length, list.length - model.limit); assert.deepEqual(noisy, list.filter(name => !hidden.includes(name)), 'the list without them, same order');
      assert.deepEqual(fontNoiseHidden(list, seed), hidden, 'deterministic'); assert.deepEqual(noisyFontList([...list], seed), noisy, 'by value, not by identity');
      for (const name of FONT_NOISE_MANDATORY) if (list.includes(name)) assert.ok(noisy.includes(name), name + ' is never left out');
    }
  }
});

test('the result is a fresh array, the input is not changed, a seed is normalized to 32 bits and anything that is not an integer leaves the list whole', () => {
  const list = windowsFonts(), before = [...list], noisy = noisyFontList(list, 7);
  assert.deepEqual(list, before); assert.notEqual(noisy, list); noisy.push('Evil Font'); assert.deepEqual(list, before);
  assert.deepEqual(noisyFontList(list, 7 + 2 ** 32), noisyFontList(list, 7)); assert.deepEqual(noisyFontList(list, -1), noisyFontList(list, 0xffffffff));
  for (const seed of ['7', 1.5, NaN, Infinity, null, undefined, {}, [], true]) { assert.deepEqual(fontNoiseHidden(list, seed), [], String(seed)); assert.deepEqual(noisyFontList(list, seed), list, String(seed)); assert.notEqual(noisyFontList(list, seed), list); }
  assert.deepEqual(noisyFontList('not a list', 3), []); assert.deepEqual(noisyFontList(undefined, 3), []);
  // Non-string entries are neither hidden nor lost.
  assert.deepEqual(noisyFontList(['Zz A', 5, null, 'Zz B'], 1), ['Zz A', 5, null, 'Zz B'].filter(entry => typeof entry !== 'string' || !fontNoiseHidden(['Zz A', 'Zz B'], 1).includes(entry)));
});

test('different seeds give different lists, and a few pinned vectors fix the algorithm', () => {
  const list = windowsFonts({ windows11: true }), seen = new Set();
  for (let index = 0; index < 400; index++) seen.add(fontNoiseHidden(list, seedAt(index)).join('|'));
  // Two single families out of about forty candidates: roughly 740 possible sets, so 400 seeds meet each other now and then (the seeds are fixed: 268 today).
  assert.ok(seen.size >= 240, 'among 400 seeds at least 240 different sets of 2 families (' + seen.size + ')');
  let different = 0; for (let index = 0; index < 400; index += 2) if (fontNoiseHidden(list, seedAt(index)).join() !== fontNoiseHidden(list, seedAt(index + 1)).join()) different++;
  assert.ok(different >= 195, 'two profiles with the same level differ in their font list: ' + different + ' of 200 pairs');
  const core = windowsFonts();
  assert.deepEqual(fontNoiseHidden(core, 1), ['Nirmala UI', 'Nirmala UI Semilight']); assert.deepEqual(fontNoiseHidden(core, 2), ['NSimSun', 'SimSun']); assert.deepEqual(fontNoiseHidden(core, 123456789), ['Gadugi', 'Sitka Small']);
  assert.deepEqual(fontNoiseHidden(core, 1), fontNoiseHidden(core, 1)); assert.notDeepEqual(fontNoiseHidden(core, 1), fontNoiseHidden(core, 2));
  // Families with more names than the limit never fit the budget at the base level; the Office lists can hide them.
  const reachable = new Set(); for (let index = 0; index < 2000; index++) for (const name of fontNoiseHidden(core, seedAt(index))) reachable.add(name);
  for (const name of ['Yu Gothic', 'Microsoft YaHei', 'Microsoft JhengHei']) assert.ok(!reachable.has(name), name + ' (more names than the limit) is not left out of the base list');
  assert.ok(reachable.has('Candara') && reachable.has('Bahnschrift') && reachable.has('Javanese Text'));
});

test('removedByNoise is the inverse: it names what a stored list lacks when that is a valid noise set, and nothing else', () => {
  for (const groups of COMBOS) {
    const list = windowsFonts(groups), model = fontNoiseModel(list);
    for (let index = 0; index < 20; index++) { const seed = seedAt(index), noisy = noisyFontList(list, seed); assert.deepEqual(removedByNoise(list, noisy, model), fontNoiseHidden(list, seed), label(groups)); assert.deepEqual(removedByNoise(list, noisy), fontNoiseHidden(list, seed)); }
    assert.deepEqual(removedByNoise(list, [...list], model), [], 'an unchanged list lacks nothing');
  }
  const list = windowsFonts({ windows11: true }), model = fontNoiseModel(list), without = (...names) => list.filter(name => !names.includes(name));
  assert.deepEqual(removedByNoise(list, without('Gabriola'), model), ['Gabriola'], 'one whole optional family is a valid, if smaller, noise set');
  assert.deepEqual(removedByNoise(list, without('Candara', 'Candara Light'), model), ['Candara', 'Candara Light']);
  assert.equal(removedByNoise(list, without('Candara Light'), model), null, 'a variant without its base');
  assert.equal(removedByNoise(list, without('Candara'), model), null, 'a base without its variant');
  assert.equal(removedByNoise(list, without('Arial'), model), null, 'a mandatory name'); assert.equal(removedByNoise(list, without('Arial Black'), model), null, 'a variant of a mandatory family');
  assert.equal(removedByNoise(list, without('Arial', 'Arial Black'), model), null, 'a whole mandatory family'); assert.equal(removedByNoise(list, without('Marlett'), model), null, 'a mandatory family of one name'); assert.equal(removedByNoise(list, without('Helvetica'), model), null, 'a platform alias');
  assert.equal(removedByNoise(list, without('Segoe UI Variable Text'), model), null);
  assert.equal(removedByNoise(list, without('Gabriola', 'Gadugi', 'Ebrima'), model), null, 'more than the limit (' + model.limit + ')');
  assert.equal(removedByNoise(list, [...without('Gabriola')].reverse(), model), null, 'a different order');
  assert.equal(removedByNoise(list, [...without('Gabriola'), 'Zz Own'], model), null, 'a name the list does not hold');
  assert.equal(removedByNoise(list, [...list, 'Zz Own'], model), null); assert.equal(removedByNoise(list, [], model), null);
  assert.equal(removedByNoise(list, without('Gabriola').map(name => name.toLowerCase()), model), null, 'names are compared exactly');
  for (const junk of [undefined, null, 'Arial', 5, {}]) assert.equal(removedByNoise(list, junk, model), null);
  assert.equal(removedByNoise(list, [...without('Gabriola').slice(0, 20), 5, ...without('Gabriola').slice(21)], model), null);
});

test('noise follows a list when the claimed Windows changes: the same names give the same seed, the new list gets its own limit, mandatory names stay', () => {
  const names = ['Corbel', 'Corbel Light'];
  assert.equal(noiseSeedFromNames(names), noiseSeedFromNames([...names].reverse()), 'order does not matter'); assert.equal(noiseSeedFromNames(names), noiseSeedFromNames(names.map(name => name.toUpperCase())), 'case does not matter');
  assert.notEqual(noiseSeedFromNames(names), noiseSeedFromNames(['Gabriola', 'Gadugi'])); assert.ok(Number.isInteger(noiseSeedFromNames([])) && noiseSeedFromNames([]) >>> 0 === noiseSeedFromNames([]));
  for (const groups of COMBOS) {
    const list = windowsFonts(groups), followed = followFontNoise(list, names), model = fontNoiseModel(list);
    assert.deepEqual(followed, noisyFontList(list, noiseSeedFromNames(names))); assert.equal(followed.length, list.length - model.limit);
    assert.deepEqual(followFontNoise(list, names), followed, 'deterministic');
    for (const name of FONT_NOISE_MANDATORY) if (list.includes(name)) assert.ok(followed.includes(name), name);
  }
  assert.deepEqual(fontValues({ windows11: true, followNoise: [] })[0].raw.families, windowsFonts({ windows11: true }), 'nothing to follow: the plain list');
  assert.deepEqual(fontValues({ windows11: true, followNoise: names })[0].raw.families, followFontNoise(windowsFonts({ windows11: true }), names));
  assert.deepEqual(fontValues({ windows11: true, noiseSeed: 9, followNoise: names })[0].raw.families, noisyFontList(windowsFonts({ windows11: true }), 9), 'an explicit seed wins');
  assert.deepEqual(fontValues({ windows11: true, noiseSeed: 'x' })[0].raw.families, windowsFonts({ windows11: true }), 'a seed that is not an integer is no seed');
  assert.deepEqual(fontValues({ windows11: true, noiseSeed: 'x', followNoise: names })[0].raw.families, followFontNoise(windowsFonts({ windows11: true }), names), 'and then the names to follow decide');
});

test('the generator: Strict with font noise writes the noisy list of its seed; without the flag, or in a lighter preset, nothing changes', () => {
  const plain = families(strict(11).configuration), noisy = families(strict(11, { fontNoise: true }).configuration);
  assert.deepEqual(plain, windowsFonts({ windows11: true })); assert.deepEqual(noisy, noisyFontList(windowsFonts({ windows11: true }), 11), 'the generation seed drives the noise');
  assert.deepEqual(families(strict(11, { fontNoise: true }).configuration), noisy, 'same seed, same list'); assert.notDeepEqual(families(strict(12, { fontNoise: true }).configuration), noisy, 'another seed, another list');
  assert.deepEqual(families(strict(11, { fontNoise: false }).configuration), plain);
  for (const flag of ['true', 1, 'yes', {}, [], null]) assert.deepEqual(families(strict(11, { fontNoise: flag }).configuration), plain, 'only true switches the noise on: ' + JSON.stringify(flag));
  // The list depends on the seed and the claimed Windows, on nothing else of the device.
  assert.deepEqual(families(strict(11, { fontNoise: true, deviceType: 'laptop', browser: 'edge', gpu: undefined }).configuration), noisy);
  assert.deepEqual(families(strict(11, { fontNoise: true, os: 'windows-10' }).configuration), noisyFontList(windowsFonts(), 11));
  assert.deepEqual(families(strict(11, { fontNoise: true, fontGroups: { office: true, panEuropean: true } }).configuration), noisyFontList(windowsFonts({ windows11: true, office: true, panEuropean: true }), 11));
  for (const protection of ['compatibility', 'balanced']) assert.equal(valueOf(generateConsistentDevice(base, { deviceType: 'desktop', protection, seed: 11, fontNoise: true }).configuration)('canvas-font-policy'), undefined, protection + ' writes no font list, noise or not');
  // Without a seed the generator draws one, and the list is still a valid noise set of the claimed Windows.
  const drawn = families(generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', fontNoise: true }).configuration);
  assert.equal(removedByNoise(windowsFonts({ windows11: true }), drawn)?.length, 2);
  // buildDeviceValues is the same path.
  assert.deepEqual(buildDeviceValues({ os: 'windows-11', fonts: true, fontNoise: true, seed: 11 }).values.find(entry => entry.id === 'canvas-font-policy').raw.families, noisy);
  assert.deepEqual(buildDeviceValues({ os: 'windows-11', fonts: true, seed: 11 }).values.find(entry => entry.id === 'canvas-font-policy').raw.families, plain);
  assert.equal(buildDeviceValues({ os: 'windows-11', fontNoise: true, seed: 11 }).values.some(entry => entry.id === 'canvas-font-policy'), false, 'no font list was asked for');
});

test('the Custom row keeps its shape and the contract accepts the list: families and fallback only, bounded, a valid configuration that round-trips', () => {
  for (let index = 0; index < 20; index++) {
    const configuration = strict(seedAt(index), { fontNoise: true, fontGroups: { office: true, panEuropean: true } }).configuration, row = configuration.apis.find(item => item.id === 'canvas-font-policy');
    assert.deepEqual(Object.keys(row.selected.value).sort(), ['fallback', 'families']); assert.equal(row.selected.value.fallback, 'sans-serif');
    assert.ok(row.selected.value.families.length <= 256 && new Set(row.selected.value.families).size === row.selected.value.families.length);
    assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: row.selected.value }).ok, true);
    assert.equal(validateApiConfiguration(configuration).ok, true); assert.deepEqual(validateApiConfiguration(JSON.parse(JSON.stringify(configuration))).value, configuration);
  }
  const clean = strict(5).configuration, noisy = strict(5, { fontNoise: true }).configuration;
  assert.deepEqual(Object.keys(noisy), Object.keys(clean), 'no new key in the configuration'); assert.equal(noisy.formatVersion, clean.formatVersion);
  const changed = noisy.apis.filter((row, position) => JSON.stringify(row) !== JSON.stringify(clean.apis[position])).map(row => row.id);
  assert.deepEqual(changed, ['canvas-font-policy'], 'the font row is the only row that differs');
});

test('describeDevice reads noise back for every claimable list; hand edits stay custom; a plain list reports no noise', () => {
  for (const groups of COMBOS) {
    const list = windowsFonts(groups);
    for (let index = 0; index < 6; index++) {
      const seed = seedAt(index), device = describeDevice(valueOf(withFonts(base, noisyFontList(list, seed))));
      assert.equal(device.fonts, 'windows', label(groups)); assert.deepEqual(device.fontGroups, groups); assert.equal(device.fontNoise, true); assert.deepEqual(device.fontHidden, fontNoiseHidden(list, seed));
    }
    const plain = describeDevice(valueOf(withFonts(base, list))); assert.equal(plain.fonts, 'windows'); assert.equal(plain.fontNoise, false); assert.deepEqual(plain.fontHidden, []);
  }
  const list = windowsFonts({ windows11: true }), describeList = names => describeDevice(valueOf(withFonts(base, names)));
  for (const names of [list.filter(name => name !== 'Arial'), list.filter(name => !['Gabriola', 'Gadugi', 'Ebrima'].includes(name)), list.filter(name => name !== 'Candara Light'), [...list].reverse(), list.slice(0, 50), [...list, 'Zz Own']]) {
    const device = describeList(names); assert.equal(device.fonts, 'custom'); assert.equal(device.fontGroups, null); assert.equal(device.fontNoise, null); assert.equal(device.fontHidden, null);
  }
  // One optional family fewer is, by design, indistinguishable from a small noise set (a hand edit of that size is still the Windows list).
  assert.equal(describeList(list.filter(name => name !== 'Gabriola')).fontNoise, true);
  const untouched = describeDevice(() => undefined); assert.equal(untouched.fontNoise, null); assert.equal(untouched.fontHidden, null);
});

test('the OS control: a change of the claimed Windows keeps noise (it follows the lost names), Windows in the Fonts control writes the plain list, Browser resets it', () => {
  const generated = strict(31, { fontNoise: true }).configuration, hiddenBefore = describeDevice(valueOf(generated)).fontHidden;
  assert.equal(hiddenBefore.length, 2);
  const ten = applyDevicePatch(generated, { os: 'windows-10' });
  assert.equal(ten.device.fonts, 'windows'); assert.equal(ten.device.fontNoise, true); assert.deepEqual(ten.device.fontGroups, { windows11: false, office: false, panEuropean: false });
  assert.deepEqual(families(ten.configuration), followFontNoise(windowsFonts(), hiddenBefore), 'the noise of the new list follows the names of the old one');
  assert.equal(families(ten.configuration).length, 94);
  const back = applyDevicePatch(ten.configuration, { os: 'windows-11' });
  assert.equal(back.device.fontNoise, true); assert.equal(families(back.configuration).length, 100); assert.ok(families(back.configuration).includes('Segoe UI Variable'));
  assert.deepEqual(applyDevicePatch(ten.configuration, { os: 'windows-11' }).configuration, back.configuration, 'deterministic');
  // Optional groups survive an OS change together with the noise.
  const office = strict(32, { fontNoise: true, fontGroups: { office: true } }).configuration, officeTen = applyDevicePatch(office, { os: 'windows-10' });
  assert.equal(officeTen.device.fontGroups.office, true); assert.equal(officeTen.device.fontNoise, true); assert.equal(families(officeTen.configuration).length, 211 - 5);
  // A plain list stays plain; an explicit Fonts choice rewrites the plain list; resetting returns the row to the browser.
  assert.equal(applyDevicePatch(strict(31).configuration, { os: 'windows-10' }).device.fontNoise, false);
  const manual = applyDevicePatch(generated, { fonts: 'windows' });
  assert.deepEqual(families(manual.configuration), windowsFonts({ windows11: true })); assert.equal(manual.device.fontNoise, false);
  assert.equal(applyDevicePatch(generated, { fonts: null }).configuration.apis.find(row => row.id === 'canvas-font-policy').mode, 'bypass');
  // A seed in the patch does not touch the font list.
  assert.deepEqual(families(applyDevicePatch(generated, { cores: 8, seed: 5 }).configuration), families(generated));
});

test('the HTML/CSS shield and the Canvas policy hide what noise left out, in step with the list', () => {
  const list = windowsFonts({ windows11: true }), seed = 77, noisy = noisyFontList(list, seed), left = fontNoiseHidden(list, seed);
  const shield = new Set(hiddenFontNames(noisy).map(lower));
  for (const name of left) assert.ok(shield.has(lower(name)), name + ' is hidden by the shield');
  for (const name of noisy) assert.ok(!shield.has(lower(name)), name + ' stays visible');
  assert.equal(hiddenFontNames(noisy).length, hiddenFontNames(list).length + left.length);
  const aliases = ['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times'];
  for (let index = 0; index < 50; index++) { const visible = new Set(hiddenFontNames(noisyFontList(list, seedAt(index))).map(lower)); for (const alias of aliases) assert.ok(!visible.has(lower(alias)), alias + ' is never hidden by noise'); }
  assert.ok(WINDOWS_FONT_GROUPS.core.includes('Helvetica'));
});

// ---- ADR-110 addendum 2: the families of a claimed region are mandatory for that list only ----------------------------------------------------------------
test('the families of a claimed region (its group and the base-script families) are never left out, for any seed; the 29 roots of every other claim stay as they are', () => {
  assert.equal(FONT_NOISE_MANDATORY.length, 29, 'the regional roots do not enlarge the set');
  for (const key of REGION_FONT_GROUP_KEYS) for (const windows11 of [false, true]) {
    const list = windowsFonts({ windows11, regionGroup: key }), roots = regionFontRoots(key), model = fontNoiseModel(list, roots);
    const lockedNames = new Set(model.units.filter(unit => unit.locked).flatMap(unit => unit.names).map(lower));
    for (const name of roots) assert.ok(lockedNames.has(lower(name)), key + ': ' + name + ' is locked');
    for (const name of WINDOWS_FONT_GROUPS[key]) assert.ok(list.includes(name), name);
    for (let index = 0; index < 120; index++) {
      const seed = seedAt(index), hidden = fontNoiseHidden(list, seed, roots), noisy = noisyFontList(list, seed, roots);
      assert.equal(hidden.length, model.limit, key + ' seed ' + seed);
      for (const name of roots) assert.ok(noisy.includes(name), key + ' seed ' + seed + ' keeps ' + name);
      for (const name of FONT_NOISE_MANDATORY) if (list.includes(name)) assert.ok(noisy.includes(name), name);
      assert.deepEqual(removedByNoise(list, noisy, model), hidden, 'the stored list is recognized with the same lock');
    }
  }
  // The lock is the claim's, not the list's: in a list without a claimed region MS PGothic is an optional family that some seed leaves out; in the Japanese claim no seed does.
  const plain = windowsFonts({ windows11: true }), japan = windowsFonts({ windows11: true, regionGroup: 'regionJa' }), roots = regionFontRoots('regionJa');
  let seed = 1; while (seed < 60000 && !fontNoiseHidden(plain, seed).includes('MS PGothic')) seed++;
  assert.ok(fontNoiseHidden(plain, seed).includes('MS PGothic'), 'MS PGothic is optional without a claimed region (seed ' + seed + ')');
  assert.ok(!fontNoiseHidden(japan, seed, roots).includes('MS PGothic'));
  for (let index = 0; index < 300; index++) assert.ok(!fontNoiseHidden(japan, seedAt(index), roots).includes('MS PGothic'));
  assert.equal(fontNoiseModel(japan).units.find(unit => unit.names.includes('MS PGothic')).locked, false, 'with no lock passed the Japanese list leaves it optional too');
  assert.equal(fontNoiseModel(japan, roots).units.find(unit => unit.names.includes('MS PGothic')).locked, true);
  // The lock only adds roots: nothing of it is passed when no region is claimed.
  assert.deepEqual(fontNoiseHidden(plain, 5, []), fontNoiseHidden(plain, 5)); assert.deepEqual(fontNoiseHidden(plain, 5, regionFontRoots(null)), fontNoiseHidden(plain, 5));
  for (const junk of [undefined, null, 'MS PGothic', 7, {}]) assert.deepEqual(fontNoiseHidden(plain, 5, junk), fontNoiseHidden(plain, 5), 'a lock that is not a list adds nothing');
});

test('regional lists keep a limit of about 3 %, a list of real size never leaves out fewer than two names, and the floor leaves a short list alone', () => {
  const expected = { regionJa: [[113, 65, 48, 2], [119, 69, 50, 2]], regionKo: [[104, 49, 55, 2], [110, 53, 57, 2]], regionZhHans: [[100, 50, 50, 2], [106, 54, 52, 2]], regionZhHant: [[100, 50, 50, 2], [106, 54, 52, 2]] };
  for (const key of REGION_FONT_GROUP_KEYS) for (const [position, windows11] of [[0, false], [1, true]]) {
    const list = windowsFonts({ windows11, regionGroup: key }), model = fontNoiseModel(list, regionFontRoots(key));
    assert.deepEqual([list.length, list.length - model.optional, model.optional, model.limit], expected[key][position], key + (windows11 ? ' Windows 11' : ' Windows 10'));
  }
  assert.equal(FONT_NOISE_MIN, 2); assert.equal(FONT_NOISE_FLOOR_FROM, 40);
  // The Japanese Windows 10 list has 48 optional names: 3 % of 48 is 1.44, which rounds to 1; the floor makes it 2.
  assert.equal(Math.round(48 * FONT_NOISE_SHARE), 1); assert.equal(fontNoiseModel(windowsFonts({ regionGroup: 'regionJa' }), regionFontRoots('regionJa')).limit, 2);
  assert.equal(fontNoiseHidden(windowsFonts({ regionGroup: 'regionJa' }), 3, regionFontRoots('regionJa')).length, 2);
  // A list of 40 optional names is of real size (the floor applies), one of 39 is not (the plain share does); neither has a locked name here.
  const names = count => Array.from({ length: count }, (_, index) => 'Zq' + index);
  assert.equal(fontNoiseModel(names(40)).limit, 2); assert.equal(fontNoiseModel(names(39)).limit, 1); assert.equal(fontNoiseModel(names(10)).limit, 0); assert.equal(fontNoiseModel(names(200)).limit, 6);
  // Every list that was valid before (the eight without a regional group) has the limit it had: the floor changed none of them.
  for (const [office, limit] of [[false, 2], [true, 5]]) for (const windows11 of [false, true]) assert.equal(fontNoiseModel(windowsFonts({ windows11, office })).limit, limit);
});

test('the lock decides what a stored list may lack: a regional family or a base-script family of the claimed region is no noise, while the same absence without the claim is', () => {
  const japan = windowsFonts({ windows11: true, regionGroup: 'regionJa' }), model = fontNoiseModel(japan, regionFontRoots('regionJa')), without = (...names) => japan.filter(name => !names.includes(name));
  assert.equal(removedByNoise(japan, without('MS PGothic'), model), null, 'a base-script family of the region');
  assert.equal(removedByNoise(japan, without('MS Mincho'), model), null, 'a family of the regional group');
  assert.equal(removedByNoise(japan, without('Yu Mincho', 'Yu Mincho Light', 'Yu Mincho Demibold'), model), null, 'a whole regional group family does not fit the limit and is locked');
  assert.deepEqual(removedByNoise(japan, without('MS PGothic')), ['MS PGothic'], 'without the lock the same absence is a valid noise set');
  assert.deepEqual(removedByNoise(japan, without('Ink Free'), model), ['Ink Free'], 'an optional family is noise in the claim too');
  // The noise of another claim's list is judged with that claim's lock: Korean names are not locked in a Japanese list.
  const mixed = windowsFonts({ windows11: true, regionGroup: 'regionKo' }), koreanModel = fontNoiseModel(mixed, regionFontRoots('regionKo'));
  assert.equal(removedByNoise(mixed, mixed.filter(name => name !== 'Batang'), koreanModel), null); assert.deepEqual(removedByNoise(mixed, mixed.filter(name => name !== 'Batang')), ['Batang'], 'Batang continues nothing, so without the lock it is a single optional family');
});

test('noise follows a list across a change of the claimed region and keeps the families of the new region', () => {
  const hidden = ['Corbel', 'Corbel Light'];
  for (const key of [undefined, ...REGION_FONT_GROUP_KEYS]) {
    const list = windowsFonts({ windows11: true, regionGroup: key }), roots = regionFontRoots(key), followed = followFontNoise(list, hidden, roots);
    assert.deepEqual(followed, noisyFontList(list, noiseSeedFromNames(hidden), roots)); assert.equal(followed.length, list.length - fontNoiseModel(list, roots).limit);
    for (const name of roots) assert.ok(followed.includes(name), String(key) + ': ' + name);
  }
  assert.deepEqual(fontValues({ windows11: true, region: 'JP', followNoise: hidden })[0].raw.families, followFontNoise(windowsFonts({ windows11: true, regionGroup: 'regionJa' }), hidden, regionFontRoots('regionJa')));
  assert.deepEqual(fontValues({ windows11: true, region: 'JP', noiseSeed: 9 })[0].raw.families, noisyFontList(windowsFonts({ windows11: true, regionGroup: 'regionJa' }), 9, regionFontRoots('regionJa')));
  for (const region of ['US', 'DE', null, undefined, 'jp ', 5]) assert.deepEqual(fontValues({ windows11: true, region, noiseSeed: 9 })[0].raw.families, noisyFontList(windowsFonts({ windows11: true }), 9), 'a region without a group adds nothing: ' + String(region));
  assert.deepEqual(fontValues({ windows11: true, region: 'jp' })[0].raw.families, windowsFonts({ windows11: true, regionGroup: 'regionJa' }), 'the code is read in any letter case');
});
