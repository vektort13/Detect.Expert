// Realistic screens: a panel at a Windows display scale. Windows Chrome reports screen.width/height in CSS pixels =
// physical panel / scale and devicePixelRatio = scale (measured on Chrome 156: a 3840x2160 panel at 150% reports
// 2560x1440 @1.5). The weights of the random draw are heuristics, so only their order of magnitude is asserted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { SCREEN_PANELS, SCREEN_PRESETS, WINDOWS_SCALES, buildDeviceValues, describeDevice, screenValues, screensFor, screenScalesFor, resolveScreen, windowsTaskbar, GPU_PRESETS } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const valueOf = configuration => id => val(configuration, id);
const rows = list => id => list.find(row => row.id === id)?.raw;
// panel -> [scale, CSS width, CSS height]; CSS size = round(panel / scale). The scale 1 of 3840x2160 is user-only.
const TABLE = {
  '1366x768': [[1, 1366, 768]],
  '1920x1080': [[1, 1920, 1080], [1.25, 1536, 864], [1.5, 1280, 720]],
  '1920x1200': [[1, 1920, 1200], [1.25, 1536, 960]],
  '2560x1440': [[1, 2560, 1440], [1.25, 2048, 1152], [1.5, 1707, 960]],
  '3840x2160': [[1.5, 2560, 1440], [1.75, 2194, 1234], [2, 1920, 1080], [1, 3840, 2160]],
};
const ladderId = (panel, scale) => SCREEN_PRESETS.find(entry => entry.panel === panel && entry.scale === scale)?.id ?? panel;

test('the panel table holds the five panels with the Windows scale steps and the right CSS sizes', () => {
  assert.deepEqual(SCREEN_PANELS.map(panel => panel.id), Object.keys(TABLE));
  assert.deepEqual([...WINDOWS_SCALES], [1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
  for (const panel of SCREEN_PANELS) {
    const drawn = panel.scales.map(([scale]) => scale), expected = TABLE[panel.id];
    assert.deepEqual([...drawn, ...panel.userScales].sort((a, b) => a - b), expected.map(([scale]) => scale).sort((a, b) => a - b), panel.id + ' scales');
    assert.equal(panel.scales.reduce((sum, [, weight]) => sum + weight, 0), 100, panel.id + ' weights sum to 100');
    assert.ok(drawn.every(scale => WINDOWS_SCALES.includes(scale)), panel.id + ' draws only Windows scale steps');
    for (const [scale, width, height] of expected) {
      assert.equal(Math.round(panel.width / scale), width, `${panel.id}@${scale} width`);
      assert.equal(Math.round(panel.height / scale), height, `${panel.id}@${scale} height`);
    }
  }
  // 1366x768 has the one scale; 3840x2160 at 100% exists only for the user and is never drawn.
  assert.deepEqual(SCREEN_PANELS[0].scales.map(([scale]) => scale), [1]);
  const fourK = SCREEN_PANELS.find(panel => panel.id === '3840x2160');
  assert.deepEqual(fourK.scales.map(([scale]) => scale), [1.5, 1.75, 2]); assert.deepEqual([...fourK.userScales], [1]);
});

test('screenValues writes CSS size = round(panel / scale), the scale as DPR and the taskbar in CSS pixels for every panel and scale', () => {
  for (const [panel, combos] of Object.entries(TABLE)) for (const [scale, width, height] of combos) for (const os of ['windows-10', 'windows-11']) {
    const list = screenValues(panel, os, { geometry: true, scale }), read = rows(list), label = `${panel}@${scale}/${os}`;
    assert.equal(read('screen-width'), width, label); assert.equal(read('screen-height'), height, label);
    assert.equal(read('window-device-pixel-ratio'), scale, label);
    assert.equal(read('screen-avail-width'), width, label); assert.equal(read('screen-avail-height'), height - windowsTaskbar(os), label + ' avail = screen minus taskbar');
    const geometry = read('screen-geometry'), media = read('css-media');
    assert.ok(geometry.innerHeight < geometry.outerHeight && geometry.outerHeight === read('screen-avail-height') && geometry.outerHeight - geometry.innerHeight >= 80, label + ' window metrics');
    assert.equal(media.resolutionDppx, scale, label); assert.equal(media.viewportWidth, geometry.innerWidth, label); assert.equal(media.viewportHeight, geometry.innerHeight, label);
  }
  // The four values named in the task.
  const css = (panel, scale) => { const read = rows(screenValues(panel, 'windows-11', { scale })); return read('screen-width') + 'x' + read('screen-height') + '@' + read('window-device-pixel-ratio'); };
  assert.equal(css('1920x1080', 1.25), '1536x864@1.25'); assert.equal(css('1920x1080', 1.5), '1280x720@1.5');
  assert.equal(css('3840x2160', 1.5), '2560x1440@1.5'); assert.equal(css('2560x1440', 1.5), '1707x960@1.5');
  // Measured on this machine: 4K panel at 150%, Windows 11 -> avail height 1392 (taskbar 48).
  assert.equal(rows(screenValues('3840x2160', 'windows-11', { scale: 1.5 }))('screen-avail-height'), 1392);
  // A scale the panel does not have falls back to the default of the id (never an impossible pair).
  assert.equal(rows(screenValues('1366x768', 'windows-11', { scale: 2 }))('window-device-pixel-ratio'), 1);
});

test('the old ladder ids stay valid and keep their meaning; 3840x2160 now defaults to 150 %', () => {
  const byId = Object.fromEntries(SCREEN_PRESETS.map(entry => [entry.id, entry]));
  for (const [id, width, height, dpr] of [['1366x768', 1366, 768, 1], ['1536x864', 1536, 864, 1.25], ['1920x1080', 1920, 1080, 1], ['2560x1440', 2560, 1440, 1]]) {
    assert.deepEqual([byId[id].width, byId[id].height, byId[id].dpr], [width, height, dpr], id);
  }
  assert.deepEqual([byId['3840x2160'].width, byId['3840x2160'].height, byId['3840x2160'].dpr], [2560, 1440, 1.5], 'an unscaled 4K is no longer the default');
  assert.ok(byId['1920x1200'], 'the new 16:10 panel is on the ladder');
  for (const entry of SCREEN_PRESETS) {
    assert.ok(entry.id && Number.isInteger(entry.width) && Number.isInteger(entry.height) && entry.dpr === entry.scale && entry.types.length >= 1, entry.id);
    assert.ok(screenScalesFor(entry.id).includes(entry.scale), entry.id + ' default scale is one the panel has');
  }
  assert.deepEqual(screenScalesFor('nope'), []);
  assert.deepEqual(screensFor('laptop').map(entry => entry.id), ['1366x768', '1536x864', '1920x1080', '1920x1200']);
  assert.deepEqual(screensFor('desktop').map(entry => entry.id), ['1536x864', '1920x1080', '1920x1200', '2560x1440', '3840x2160']);
  assert.equal(resolveScreen('nope'), null);
  assert.equal(resolveScreen('1920x1080', 1.25).id, '1536x864', 'a panel id with the legacy rung scale resolves to the rung');
  assert.equal(resolveScreen('1920x1080', 1.5).id, '1920x1080'); assert.equal(resolveScreen('1920x1080', 1.5).width, 1280);
});

test('20,000 seeds per device type never draw 3840x2160 at 100 % and only draw scales the panel has', () => {
  const seen = new Map();
  for (const deviceType of ['desktop', 'laptop']) for (let seed = 0; seed < 20000; seed++) {
    const { summary } = buildDeviceValues({ deviceType, seed }), panel = SCREEN_PANELS.find(entry => entry.id === summary.panel);
    assert.ok(panel.scales.some(([scale]) => scale === summary.scale), `${summary.panel}@${summary.scale} is a drawable pair`);
    assert.ok(!(summary.panel === '3840x2160' && summary.scale === 1), 'no unscaled 4K');
    assert.ok(!(summary.width === 3840 && summary.height === 2160 && summary.dpr === 1));
    assert.equal(summary.width, Math.round(panel.width / summary.scale)); assert.equal(summary.height, Math.round(panel.height / summary.scale)); assert.equal(summary.dpr, summary.scale);
    assert.equal(summary.screen, ladderId(summary.panel, summary.scale), 'the summary names the ladder id of the pair');
    seen.set(`${deviceType}:${summary.panel}@${summary.scale}`, (seen.get(`${deviceType}:${summary.panel}@${summary.scale}`) ?? 0) + 1);
  }
  // Every drawable pair of the panels a class can get really occurs (the draw is not stuck on one scale).
  for (const key of ['desktop:1920x1080@1', 'desktop:1920x1080@1.25', 'desktop:1920x1080@1.5', 'desktop:2560x1440@1', 'desktop:2560x1440@1.25', 'desktop:2560x1440@1.5', 'desktop:3840x2160@1.5', 'desktop:3840x2160@1.75', 'desktop:3840x2160@2', 'laptop:1366x768@1', 'laptop:1920x1080@1.25', 'laptop:1920x1200@1', 'laptop:1920x1200@1.25']) assert.ok(seen.get(key) > 0, key + ' occurs');
  // Heuristic weights 55 / 30 / 15 for 1920x1080: loose bounds only.
  const total = [1, 1.25, 1.5].reduce((sum, scale) => sum + (seen.get(`laptop:1920x1080@${scale}`) ?? 0), 0), share = scale => (seen.get(`laptop:1920x1080@${scale}`) ?? 0) / total;
  assert.ok(share(1) > 0.45 && share(1) < 0.65 && share(1.25) > 0.2 && share(1.25) < 0.4 && share(1.5) > 0.07 && share(1.5) < 0.23, `1920x1080 shares ${share(1).toFixed(2)} ${share(1.25).toFixed(2)} ${share(1.5).toFixed(2)}`);
  // Every card of the catalogue draws a valid pair too (class panels differ per performance class).
  for (const card of GPU_PRESETS) for (const deviceType of card.types) for (let seed = 0; seed < 40; seed++) {
    const { summary } = buildDeviceValues({ deviceType, gpu: card.id, seed });
    assert.ok(!(summary.panel === '3840x2160' && summary.scale === 1), card.id);
    assert.ok(screensFor(deviceType).some(entry => entry.panel === summary.panel) || SCREEN_PANELS.find(entry => entry.id === summary.panel).types.includes(deviceType), `${card.id}/${deviceType} gets a panel of its type`);
  }
});

test('describeDevice recognises old and new values and reads back screen id and scale', () => {
  // New (panel, scale) pairs round trip through the level control.
  for (const [panel, combos] of Object.entries(TABLE)) for (const [scale, width, height] of combos) {
    const result = applyDevicePatch(base, { screen: panel, scale }), label = `${panel}@${scale}`;
    assert.equal(val(result.configuration, 'screen-width'), width, label); assert.equal(val(result.configuration, 'screen-height'), height, label);
    assert.equal(result.device.screen, ladderId(panel, scale), label); assert.equal(result.device.scale, scale, label);
    const again = applyDevicePatch(base, { screen: result.device.screen, scale: result.device.scale });
    for (const id of ['screen-width', 'screen-height', 'screen-avail-height', 'window-device-pixel-ratio']) assert.equal(val(again.configuration, id), val(result.configuration, id), label + ' ' + id);
  }
  // Old saved values (the previous ladder) are still described by the same ids.
  for (const [id, width, height, dpr] of [['1366x768', 1366, 768, 1], ['1536x864', 1536, 864, 1.25], ['1920x1080', 1920, 1080, 1], ['2560x1440', 2560, 1440, 1], ['3840x2160', 3840, 2160, 1]]) {
    const device = describeDevice(rows([{ id: 'screen-width', raw: width }, { id: 'screen-height', raw: height }, { id: 'window-device-pixel-ratio', raw: dpr }]));
    assert.equal(device.screen, id, `old ${id}`); assert.equal(device.scale, dpr);
  }
  // CSS size alone (no DPR row) keeps matching the old way; an odd DPR keeps the size match and reports the DPR as it is.
  const sizeOnly = describeDevice(rows([{ id: 'screen-width', raw: 1536 }, { id: 'screen-height', raw: 864 }]));
  assert.equal(sizeOnly.screen, '1536x864'); assert.equal(sizeOnly.scale, null);
  assert.deepEqual(['screen', 'scale'].map(key => describeDevice(rows([{ id: 'screen-width', raw: 1920 }, { id: 'screen-height', raw: 1080 }, { id: 'window-device-pixel-ratio', raw: 1.1 }]))[key]), ['1920x1080', 1.1]);
  // The same CSS size can belong to two panels: the DPR decides.
  assert.equal(describeDevice(rows([{ id: 'screen-width', raw: 1920 }, { id: 'screen-height', raw: 1080 }, { id: 'window-device-pixel-ratio', raw: 2 }])).screen, '3840x2160');
  assert.equal(describeDevice(rows([{ id: 'screen-width', raw: 1280 }, { id: 'screen-height', raw: 720 }, { id: 'window-device-pixel-ratio', raw: 1.5 }])).screen, '1920x1080');
  // Unknown sizes and untouched configurations describe nothing.
  assert.equal(describeDevice(rows([{ id: 'screen-width', raw: 1111 }, { id: 'screen-height', raw: 777 }, { id: 'window-device-pixel-ratio', raw: 1 }])).screen, null);
  const empty = describeDevice(() => undefined);
  assert.equal(empty.screen, null); assert.equal(empty.scale, null);
  assert.ok(Object.values(empty).every(entry => entry === null), 'nothing is invented for an untouched configuration');
});

test('applyDevicePatch validates the scale, applies it to the current panel and keeps it across an OS change', () => {
  const half = applyDevicePatch(base, { screen: '1920x1080', scale: 1.5, os: 'windows-11' });
  assert.deepEqual(['screen-width', 'screen-height', 'screen-avail-height', 'window-device-pixel-ratio'].map(id => val(half.configuration, id)), [1280, 720, 720 - 48, 1.5]);
  assert.equal(half.device.screen, '1920x1080'); assert.equal(half.device.scale, 1.5);
  // The scale alone follows the current panel; null returns to the default of the id.
  const scaled = applyDevicePatch(applyDevicePatch(base, { screen: '1920x1080' }).configuration, { scale: 1.25 });
  assert.equal(val(scaled.configuration, 'screen-width'), 1536); assert.equal(scaled.device.screen, '1536x864');
  const back = applyDevicePatch(half.configuration, { scale: null });
  assert.equal(val(back.configuration, 'screen-width'), 1920); assert.equal(val(back.configuration, 'window-device-pixel-ratio'), 1);
  // 3840x2160: default 150 %, other drawn scales and the user-only 100 % are accepted.
  assert.equal(val(applyDevicePatch(base, { screen: '3840x2160' }).configuration, 'window-device-pixel-ratio'), 1.5);
  const unscaled = applyDevicePatch(base, { screen: '3840x2160', scale: 1 });
  assert.equal(val(unscaled.configuration, 'screen-width'), 3840); assert.equal(unscaled.device.screen, '3840x2160'); assert.equal(unscaled.device.scale, 1);
  // The OS change keeps the scale and moves the taskbar (Windows 10: 40, Windows 11: 48).
  const fourK = applyDevicePatch(base, { screen: '3840x2160', scale: 1.75, os: 'windows-11' }).configuration;
  const win10 = applyDevicePatch(fourK, { os: 'windows-10' });
  assert.equal(val(win10.configuration, 'window-device-pixel-ratio'), 1.75); assert.equal(val(win10.configuration, 'screen-width'), 2194);
  assert.equal(val(win10.configuration, 'screen-avail-height'), 1234 - 40);
  // Window geometry and the media viewport follow the scale where the profile already has them.
  const strict = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'strict', seed: 3, screen: '1920x1080', scale: 1.25 }).configuration;
  const moved = applyDevicePatch(strict, { screen: '2560x1440', scale: 1.5 }).configuration;
  assert.equal(val(moved, 'css-media').resolutionDppx, 1.5); assert.equal(val(moved, 'screen-geometry').innerWidth, 1707);
  // Refusals: a scale the panel does not have, a non-number, and a scale without any known screen change nothing.
  for (const patch of [{ screen: '1920x1080', scale: 1.75 }, { screen: '1366x768', scale: 1.25 }, { screen: '1920x1200', scale: 1.5 }, { screen: '1920x1080', scale: '1.5' }, { screen: '1920x1080', scale: NaN }, { screen: '1920x1080', scale: 0 }, { scale: 1.25 }, { screen: '640x480', scale: 1 }])
    assert.throws(() => applyDevicePatch(base, patch), /invalid-value/, JSON.stringify(patch));
  // null screen still resets the whole group.
  const reset = applyDevicePatch(half.configuration, { screen: null });
  for (const id of ['screen-width', 'window-device-pixel-ratio']) assert.equal(reset.configuration.apis.find(row => row.id === id).mode, 'bypass');
});

test('Randomize keeps a chosen ladder id at its default scale unless a scale is given; random draws follow the class panels', () => {
  const chosen = generateConsistentDevice(base, { deviceType: 'laptop', screen: '1920x1080', seed: 11 });
  assert.equal(val(chosen.configuration, 'screen-width'), 1920); assert.equal(val(chosen.configuration, 'window-device-pixel-ratio'), 1);
  assert.equal(chosen.summary.screen, '1920x1080'); assert.equal(chosen.summary.scale, 1);
  const scaled = generateConsistentDevice(base, { deviceType: 'desktop', screen: '2560x1440', scale: 1.25, seed: 11 });
  assert.equal(val(scaled.configuration, 'screen-width'), 2048); assert.equal(scaled.summary.panel, '2560x1440'); assert.equal(scaled.summary.scale, 1.25);
  assert.equal(describeDevice(valueOf(scaled.configuration)).screen, scaled.summary.screen);
  // A ladder id that does not belong to the device type falls back to the random draw; an unsupported scale to the default.
  assert.notEqual(generateConsistentDevice(base, { deviceType: 'laptop', screen: '3840x2160', seed: 5 }).summary.panel, '3840x2160');
  assert.equal(generateConsistentDevice(base, { deviceType: 'desktop', screen: '1920x1080', scale: 2, seed: 5 }).summary.scale, 1);
  // The generated profile reads back identically.
  for (let seed = 0; seed < 60; seed++) {
    const result = generateConsistentDevice(base, { deviceType: seed % 2 ? 'laptop' : 'desktop', protection: seed % 3 === 0 ? 'strict' : 'balanced', seed });
    const device = describeDevice(valueOf(result.configuration));
    assert.equal(device.screen, result.summary.screen); assert.equal(device.scale, result.summary.scale);
    assert.ok(!result.issues.some(issue => ['screen-available', 'orientation-size'].includes(issue.code)));
  }
});
