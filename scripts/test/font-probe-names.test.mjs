// ADR-110: the fixed list of family names that the HTML/CSS font shield can hide, and the part of it a profile hides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FONT_PROBE_GROUPS, FONT_PROBE_LIST_VERSION, FONT_PROBE_MAX_NAMES, FONT_PROBE_NAMES, PLATFORM_ALIASES, hiddenFontNames } from '../../apps/production-extension/font-probe-names.js';
import { WINDOWS_FONT_GROUPS, REGION_FONT_GROUP_KEYS, windowsFonts } from '../../apps/production-extension/fingerprint-font-groups.js';
import { validateFingerprintCustomValue } from '../../apps/production-extension/fingerprint-custom-values.js';

const lower = name => name.toLowerCase();
const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont'];

test('the list is frozen, bounded, de-duplicated without regard to case, and free of anything a rule text or the Custom validator would refuse', () => {
  assert.equal(FONT_PROBE_LIST_VERSION, 1);
  assert.ok(Object.isFrozen(FONT_PROBE_NAMES) && Object.isFrozen(FONT_PROBE_GROUPS) && Object.isFrozen(PLATFORM_ALIASES));
  assert.ok(FONT_PROBE_NAMES.length >= 600 && FONT_PROBE_NAMES.length <= FONT_PROBE_MAX_NAMES, 'several hundred names, never more than the cap: ' + FONT_PROBE_NAMES.length);
  assert.equal(FONT_PROBE_MAX_NAMES, 720);
  assert.equal(new Set(FONT_PROBE_NAMES.map(lower)).size, FONT_PROBE_NAMES.length, 'no name twice, whatever its case');
  for (const name of FONT_PROBE_NAMES) {
    assert.ok(/^[\x20-\x7e]{1,128}$/u.test(name) && name === name.trim(), JSON.stringify(name) + ' is printable ASCII, trimmed and short');
    assert.ok(!/["'\\,;{}<>]/u.test(name), JSON.stringify(name) + ' carries no CSS separator, quote or brace');
    // The same rule the Custom validator applies to an allow-list entry: the list can be written back into a canvas-font-policy value.
    validateFingerprintCustomValue('canvas-font-policy', { families: [name], fallback: 'sans-serif' }, 'value', (code, path, message) => assert.fail(name + ': ' + message));
  }
  for (const group of Object.values(FONT_PROBE_GROUPS)) { assert.ok(Object.isFrozen(group) && group.length > 0); for (const name of group) assert.equal(typeof name, 'string'); }
});

test('it covers every family of the Windows allow-list groups, the platform aliases, and no CSS generic or system keyword', () => {
  const keys = new Set(FONT_PROBE_NAMES.map(lower));
  for (const names of Object.values(WINDOWS_FONT_GROUPS)) for (const name of names) assert.ok(keys.has(lower(name)), name + ' of a Windows group is probe-able');
  for (const name of PLATFORM_ALIASES) assert.ok(keys.has(lower(name)), name + ' is probe-able: hidden unless the profile allows it');
  assert.deepEqual([...PLATFORM_ALIASES], ['Courier', 'Helv', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'MS Shell Dlg', 'MS Shell Dlg 2', 'Times', 'Tms Rmn']);
  for (const name of [...GENERIC, 'inherit', 'initial', 'unset', 'revert', 'default']) assert.ok(!keys.has(name), name + ' can never be shadowed');
  // Spot checks of the groups the research was about: Office, Mac, Linux, Adobe, web and developer families.
  for (const name of ['Century Gothic', 'Agency FB', 'Helvetica Neue', 'Menlo', 'DejaVu Sans', 'Liberation Sans', 'Myriad Pro', 'Roboto', 'Open Sans', 'Fira Code', 'Cascadia Code', 'Lucida Grande']) assert.ok(keys.has(lower(name)), name);
});

test('hiddenFontNames: the list minus the allowed families, compared without regard to case or surrounding space, in list order', () => {
  const hidden = hiddenFontNames(['arial', ' Segoe UI ', 'CALIBRI', 'Not In The List', 7, null, { name: 'Tahoma' }]);
  assert.ok(Object.isFrozen(hidden));
  const keys = new Set(hidden.map(lower));
  for (const kept of ['arial', 'segoe ui', 'calibri']) assert.ok(!keys.has(kept), kept + ' is allowed, so it is not hidden');
  assert.ok(keys.has('tahoma'), 'a non-string entry allows nothing');
  assert.equal(hidden.length, FONT_PROBE_NAMES.length - 3);
  assert.deepEqual(hidden, FONT_PROBE_NAMES.filter(name => !['arial', 'segoe ui', 'calibri'].includes(lower(name))), 'order is the list order');
  for (const input of [undefined, null, 'Arial', 5, {}, { 0: 'Arial', length: 1 }]) assert.deepEqual(hiddenFontNames(input), FONT_PROBE_NAMES, 'anything but an array of names hides every name');
  assert.deepEqual(hiddenFontNames([]), FONT_PROBE_NAMES);
});

test('the Windows 11 allow-list hides the Office, Pan-European and every foreign name and keeps the core names; Office and Pan-European can be allowed', () => {
  const windows = windowsFonts({ windows11: true }), hidden = new Set(hiddenFontNames(windows).map(lower));
  for (const name of windows) assert.ok(!hidden.has(lower(name)), name + ' stays visible');
  for (const name of [...WINDOWS_FONT_GROUPS.office, ...WINDOWS_FONT_GROUPS.panEuropean]) assert.ok(hidden.has(lower(name)), name + ' is not part of a clean Windows install');
  for (const name of ['Helvetica Neue', 'Menlo', 'Roboto', 'DejaVu Sans']) assert.ok(hidden.has(lower(name)), name);
  // ADR-110 addendum (owner decision 2026-11-07): the five platform aliases a genuine Windows browser resolves are part of the Windows list, so they stay
  // visible; the four Firefox-only aliases are in no list and stay hidden.
  for (const name of ['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times']) { assert.ok(windows.includes(name), name + ' is in the list'); assert.ok(!hidden.has(lower(name)), name + ' stays visible'); }
  for (const name of ['Helv', 'MS Shell Dlg', 'MS Shell Dlg 2', 'Tms Rmn']) { assert.ok(!windows.includes(name), name); assert.ok(hidden.has(lower(name)), name + ' is hidden'); }
  assert.equal(hidden.size, FONT_PROBE_NAMES.length - windows.length);
  const everything = windowsFonts({ windows11: true, office: true, panEuropean: true }), shown = new Set(hiddenFontNames(everything).map(lower));
  for (const name of everything) assert.ok(!shown.has(lower(name)), name);
  assert.equal(shown.size, FONT_PROBE_NAMES.length - everything.length);
  assert.ok(hiddenFontNames(windowsFonts()).length === FONT_PROBE_NAMES.length - windowsFonts().length, 'plain Windows 10 list: the Windows 11 names are hidden');
  // The numbers of ADR-110 (addendum 2): 716 probe names; the Windows 11 list (102 names) hides 614, the Windows 10 core list (96) hides 620, an empty list (a non-Windows claim) hides all.
  assert.equal(FONT_PROBE_NAMES.length, 716); assert.equal(windows.length, 102); assert.equal(hiddenFontNames(windows).length, 614);
  assert.equal(windowsFonts().length, 96); assert.equal(hiddenFontNames(windowsFonts()).length, 620); assert.equal(hiddenFontNames([]).length, 716);
  // With an empty list every alias is hidden, the five and the four alike.
  const none = new Set(hiddenFontNames([]).map(lower)); for (const name of PLATFORM_ALIASES) assert.ok(none.has(lower(name)), name + ' is hidden for a non-Windows claim');
});

// ADR-110 addendum 2: the families of the claimed region stay visible, those of every other region are hidden like any name the list does not allow.
test('every name of the four regional groups is a probe name: a claimed region keeps its group visible, any other claim hides it', () => {
  const keys = new Set(FONT_PROBE_NAMES.map(lower));
  for (const key of REGION_FONT_GROUP_KEYS) for (const name of WINDOWS_FONT_GROUPS[key]) assert.ok(keys.has(lower(name)), key + ': ' + name + ' is probe-able');
  // 702 before the regional groups; 14 of their 33 names were new to the list (the others were in its Windows group already).
  assert.equal(FONT_PROBE_NAMES.length, 716);
  for (const name of ['BIZ UDGothic', 'BIZ UDPGothic', 'BIZ UDMincho Medium', 'BIZ UDPMincho Medium', 'UD Digi Kyokasho N-B', 'UD Digi Kyokasho NK-B', 'UD Digi Kyokasho NK-R', 'UD Digi Kyokasho NP-B', 'UD Digi Kyokasho NP-R', 'UD Digi Kyokasho N-R', 'Yu Mincho Light', 'Yu Mincho Demibold', 'DengXian', 'DengXian Light']) assert.ok(keys.has(lower(name)), name);
  assert.ok(!keys.has('fangsong'), 'FangSong is the CSS generic keyword and cannot be shadowed');
  const expectedHidden = { regionJa: 597, regionKo: 606, regionZhHans: 610, regionZhHant: 610 };
  for (const key of REGION_FONT_GROUP_KEYS) {
    const claimed = windowsFonts({ windows11: true, regionGroup: key }), hidden = new Set(hiddenFontNames(claimed).map(lower));
    for (const name of WINDOWS_FONT_GROUPS[key]) assert.ok(!hidden.has(lower(name)), key + ' claim keeps ' + name);
    for (const other of REGION_FONT_GROUP_KEYS) if (other !== key) for (const name of WINDOWS_FONT_GROUPS[other]) assert.ok(hidden.has(lower(name)), key + ' claim hides ' + name + ' of ' + other);
    assert.equal(hidden.size, 716 - claimed.length); assert.equal(hidden.size, expectedHidden[key], key + ' hides ' + expectedHidden[key]);
  }
  // A claim without a regional group (the Windows 11 list of before, "Auto", any other region) hides every regional family.
  const plain = new Set(hiddenFontNames(windowsFonts({ windows11: true })).map(lower));
  for (const key of REGION_FONT_GROUP_KEYS) for (const name of WINDOWS_FONT_GROUPS[key]) assert.ok(plain.has(lower(name)), 'a claim without a region hides ' + name);
  // The base families of the same scripts are in core: visible in every Windows claim.
  for (const name of ['Yu Gothic', 'MS Gothic', 'Malgun Gothic', 'Microsoft YaHei', 'SimSun', 'Microsoft JhengHei', 'MingLiU-ExtB']) assert.ok(!plain.has(lower(name)), name + ' stays visible');
  // The widest list of all (Windows 11, Office, Pan-European and a regional group) still hides what it does not allow.
  const widest = windowsFonts({ windows11: true, office: true, panEuropean: true, regionGroup: 'regionJa' });
  assert.equal(hiddenFontNames(widest).length, 716 - widest.length);
});
