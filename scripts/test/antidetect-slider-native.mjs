// ADR-104 polish (owner's order 2026-11-07): the four device sliders of Antidetect (Processor, Memory, Storage quota, Screen) in a real, owned,
// disposable browser, with the extension staged FROM SOURCE into a private run folder (.tmp/antidetect-slider-<browser>-*; never dist/ or release/).
//   node scripts/test/antidetect-slider-native.mjs             Chrome (Playwright Chromium)
//   node scripts/test/antidetect-slider-native.mjs --firefox   Firefox (WebDriver; reduced-motion and forced-colours emulation do not exist there)
// What it proves: the rails of neighbouring cards sit on one line whatever the heads and hints weigh (shared subgrid rows, hint and extras in one
// "tail" cell), at every width and in both states; the chosen part is a bar that ends at the thumb centre (LTR and RTL); the sparks move only for
// people who have not asked for less motion; forced colours drop the gradients; the bar, the thumb edge and the value bubble keep their contrast in
// every theme. Nothing is applied: the draft lives only in the page and goes with it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', isChrome = browser === 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/antidetect-slider-' + browser + '-')), extension = join(run, 'extension'), shots = join(run, 'screenshots');
mkdirSync(shots, { recursive: true });
await stageExtension({ browser, target: extension, from: 'source' });
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: 'source', result: 'RUNNING', checks: [], alignment: [], fills: [], contrast: [], screenshots: [] };
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };
const KEYS = Object.freeze(['cpu', 'ram', 'disk', 'screen']);
// Themes are keyed by data-ui-theme on the root; "system" follows the colour scheme of the browser.
const THEMES = Object.freeze(['system', 'pearl', 'aurora', 'graphite', 'orchid', 'glass']);
const WIDTHS = isChrome ? [2576, 1920, 1180, 700, 520, 340] : [1920, 1180, 520, 340];
let opened = null;
const get = (fn, value) => opened.evaluate(fn, value);

async function openDevice(language = 'en') {
  await opened.goto(opened.base + 'options.html#antidetect');
  await get(code => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': code }), language);
  await until(() => get(code => document.querySelector('[data-management-shell]')?.lang === code, language), 'language ' + language);
  await until(() => get(() => Boolean(document.querySelector('[data-antidetect-category="device"]'))), 'device level button');
  await opened.click('[data-antidetect-category="device"]');
  await until(() => get(() => document.querySelectorAll('[data-profile-slider]').length === 4), 'four sliders');
}
// Picks a step the way the input event of a user does; a locked slider (nothing to set) is skipped.
const pick = (key, index) => get(value => { const input = document.getElementById('fp-slider-' + value.key); if (!input || input.disabled) return false; input.value = String(value.index); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }, { key, index });
const measure = () => get(() => ({
  width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
  sliders: [...document.querySelectorAll('[data-profile-slider]')].map(node => {
    const box = node.getBoundingClientRect(), track = node.querySelector('.fp-slider__track'), trackBox = track.getBoundingClientRect(), input = node.querySelector('.fp-slider__input'), inputBox = input.getBoundingClientRect(), tail = node.querySelector('.fp-slider__tail').getBoundingClientRect();
    const after = getComputedStyle(track, '::after'), before = getComputedStyle(track, '::before');
    return { key: node.dataset.profileSlider, auto: node.classList.contains('is-auto'), disabled: input.disabled, top: box.top, left: box.left, right: box.right, track: trackBox.top, trackH: trackBox.height, trackW: trackBox.width,
      input: inputBox.top, inputH: inputBox.height, tail: tail.top, ratio: Number(track.style.getPropertyValue('--fp-ratio')), fraction: (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)),
      fillW: parseFloat(after.width), fillLeft: after.left, fillRight: after.right, fillImage: after.backgroundImage, fillColor: after.backgroundColor, animation: after.animationName, positionX: after.backgroundPositionX,
      railH: parseFloat(before.height), railBorder: before.borderTopWidth, direction: getComputedStyle(track).direction, dir: getComputedStyle(track).getPropertyValue('--fp-dir').trim(), opacity: getComputedStyle(track).opacity };
  })
}));
// Sliders whose boxes start within one pixel of each other form a visual row.
function rowsOf(sliders) {
  const sorted = [...sliders].sort((a, b) => a.top - b.top), rows = [];
  for (const slider of sorted) { const row = rows.find(candidate => Math.abs(candidate[0].top - slider.top) <= 1); if (row) row.push(slider); else rows.push([slider]); }
  return rows;
}
async function alignment(state) {
  let widest = 0;
  for (const width of WIDTHS) {
    await opened.viewport(width, 900); await pause(450);
    const snapshot = await measure(); assert.equal(snapshot.overflow, false, state + ' at ' + width + ': the page scrolls sideways');
    for (const slider of snapshot.sliders) { assert.ok(slider.left >= -1 && slider.right <= snapshot.width + 1, state + ' at ' + width + ': ' + slider.key + ' leaves the viewport'); assert.equal(Math.round(slider.trackH), 34, 'the rail lane is 34px'); assert.equal(Math.round(slider.inputH), 34, 'the input covers the lane'); assert.ok(Math.abs(slider.input - slider.track) <= .5, 'the input overlays its lane'); }
    const rows = rowsOf(snapshot.sliders);
    for (const row of rows) {
      widest = Math.max(widest, row.length);
      for (const slider of row) assert.ok(Math.abs(slider.track - row[0].track) <= 1, state + ' at ' + width + ': the rails of ' + row.map(item => item.key).join('/') + ' are on different lines (' + row.map(item => item.track).join(' / ') + ')');
      for (const slider of row) assert.ok(Math.abs(slider.tail - row[0].tail) <= 1, state + ' at ' + width + ': the tails of ' + row.map(item => item.key).join('/') + ' start on different lines');
    }
    evidence.alignment.push({ state, width, rows: rows.map(row => ({ keys: row.map(item => item.key), rail: Math.round(row[0].track) })) });
  }
  assert.ok(widest >= 2, state + ': no width put two sliders side by side, so the alignment check proves nothing');
}
async function main() {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, userScripts: false });
  evidence.version = opened.version;
  await openDevice();
  // ---- 1. Auto state: every slider shows where the real value sits with a muted bar and no motion.
  let snapshot = await measure();
  assert.deepEqual(snapshot.sliders.map(slider => slider.key), KEYS);
  for (const slider of snapshot.sliders) {
    assert.equal(slider.auto, true, slider.key + ' starts in Auto');
    assert.equal(slider.animation, 'none', slider.key + ': an Auto bar does not move'); assert.equal(slider.fillImage, 'none', slider.key + ': an Auto bar is a flat muted colour');
    assert.ok(Math.abs(slider.fillW - (11 + (slider.trackW - 22) * slider.ratio)) <= 1, slider.key + ': the Auto bar still ends at the thumb centre');
  }
  await alignment('auto');
  check('Auto state: one muted still bar per slider, the rails of neighbouring cards on one line at ' + WIDTHS.join('/') + ' px');
  await opened.viewport(1920, 1000); await pause(400);

  // ---- 2. Chosen values: a green bar that ends at the thumb centre and is alive.
  const picks = { cpu: 2, ram: 3, disk: 1, screen: 1 }, picked = [];
  for (const key of KEYS) if (await pick(key, picks[key])) picked.push(key);
  await pause(500);
  assert.ok(picked.length >= 3, 'at least Processor, Memory and Screen can be set (got ' + picked.join(', ') + ')');
  snapshot = await measure();
  for (const slider of snapshot.sliders) {
    if (!picked.includes(slider.key)) { assert.equal(slider.auto, true); assert.equal(slider.disabled, true, slider.key + ' is locked, so it keeps its Auto state'); assert.ok(slider.opacity < 1, 'a locked slider is dimmed'); assert.equal(slider.animation, 'none'); continue; }
    assert.equal(slider.auto, false, slider.key + ' leaves Auto when a value is chosen');
    assert.ok(Math.abs(slider.ratio - slider.fraction) < .001, slider.key + ': --fp-ratio is the position of the thumb (' + slider.ratio + ' vs ' + slider.fraction + ')');
    assert.ok(Math.abs(slider.fillW - (11 + (slider.trackW - 22) * slider.ratio)) <= 1, slider.key + ': the green bar ends at the thumb centre (' + slider.fillW + ' px of ' + slider.trackW + ')');
    assert.match(slider.fillImage, /linear-gradient/u, slider.key + ': the bar is a gradient'); assert.match(slider.fillImage, /radial-gradient/u, slider.key + ': the bar carries its sparks');
    assert.equal(slider.railH, 12, 'the rail is a 12px pill'); assert.equal(slider.fillLeft, '0px', slider.key + ': in left-to-right text the bar starts at the left edge');
    evidence.fills.push({ key: slider.key, ratio: slider.ratio, fillW: slider.fillW, trackW: slider.trackW, animation: slider.animation });
  }
  // The bar follows the thumb: the last and the first step.
  const cpu = (await measure()).sliders.find(slider => slider.key === 'cpu');
  const steps = Number(await get(() => document.getElementById('fp-slider-cpu').max));
  await pick('cpu', steps); await pause(300);
  let moved = (await measure()).sliders.find(slider => slider.key === 'cpu');
  assert.ok(Math.abs(moved.fillW - (moved.trackW - 11)) <= 1, 'the last step fills up to the right thumb centre');
  await pick('cpu', 0); await pause(300);
  moved = (await measure()).sliders.find(slider => slider.key === 'cpu');
  assert.ok(Math.abs(moved.fillW - 11) <= 1, 'the first step leaves only what the thumb covers');
  await pick('cpu', picks.cpu); await pause(300);
  assert.ok(cpu.fillW > 11);
  check('A chosen value turns the bar green up to the thumb centre (first step 11px, last step track-11px), with gradient and sparks, other cards untouched');

  await alignment('chosen');
  check('Chosen state (mixed Auto/Custom heads, field hints, the window button): the rails and tails still share their lines at every width');
  await opened.viewport(1920, 1000); await pause(400);

  // ---- 3. Motion: the sparks drift for people who accept motion.
  const first = (await measure()).sliders.find(slider => slider.key === 'cpu'); assert.match(first.animation, /fp-slider-drift/u); assert.match(first.animation, /fp-slider-bob/u);
  await pause(900);
  const second = (await measure()).sliders.find(slider => slider.key === 'cpu');
  assert.notEqual(second.positionX, first.positionX, 'the sparks drift (background-position-x changes between two reads)');
  if (isChrome) {
    await opened.media({ reducedMotion: 'reduce' }); await pause(300);
    const still = (await measure()).sliders.filter(slider => !slider.auto);
    for (const slider of still) { assert.equal(slider.animation, 'none', slider.key + ': reduced motion stops the sparks'); assert.match(slider.fillImage, /linear-gradient/u, 'the bar itself stays'); }
    await opened.media({ reducedMotion: 'no-preference' }); await pause(300);
    assert.match((await measure()).sliders.find(slider => slider.key === 'cpu').animation, /fp-slider-drift/u, 'motion is back when it is allowed again');
    check('Sparks drift without a motion preference and stand still under prefers-reduced-motion (Chrome)');
  } else check('Sparks drift (Firefox has no reduced-motion emulation over WebDriver; the Chrome run covers it)');

  // ---- 4. Forced colours (Chrome): no gradients, the bar is a system colour.
  if (isChrome) {
    await opened.media({ forcedColors: 'active' }); await pause(400);
    const forced = (await measure()).sliders.filter(slider => !slider.auto);
    for (const slider of forced) {
      assert.equal(slider.fillImage, 'none', slider.key + ': forced colours drop the gradient'); assert.notEqual(slider.fillColor, 'rgba(0, 0, 0, 0)', slider.key + ': the bar is a system colour'); assert.equal(slider.animation, 'none');
      assert.ok(parseFloat(slider.railBorder) > 0, slider.key + ': the rail is outlined (' + slider.railBorder + ')');
    }
    await opened.media({ forcedColors: 'none' }); await pause(300);
    check('Forced colours: the bar is a solid system colour, the rail is outlined, nothing moves (Chrome)');
  }

  // ---- 5. Reset to Auto.
  await opened.click('[data-profile-slider-reset="cpu"]'); await pause(400);
  const reset = (await measure()).sliders.find(slider => slider.key === 'cpu');
  assert.equal(reset.auto, true); assert.equal(reset.animation, 'none'); assert.equal(reset.fillImage, 'none');
  check('The Auto button returns a slider to the muted still bar');
  await pick('cpu', picks.cpu); await pause(400);

  // ---- 6. Contrast in every theme (and the system dark scheme in Chrome).
  const contrastRow = () => get(() => {
    const resolveColor = (element, value) => { const probe = document.createElement('i'); probe.style.cssText = 'position:fixed;background-color:' + value; element.appendChild(probe); const out = getComputedStyle(probe).backgroundColor; probe.remove(); return out; };
    const parse = text => { const nums = (text.match(/-?[\d.]+/g) ?? []).slice(0, 3).map(Number); return text.startsWith('color(') ? nums.map(n => n * 255) : nums; };
    const luminance = ([r, g, b]) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const ratio = (a, b) => { const la = luminance(parse(a)), lb = luminance(parse(b)); return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05); };
    // What is rendered is read where the engine exposes it (the rail pseudo-element, the bubble, the thumb pseudo-element); the gradient itself
    // cannot be read, so its end colour comes from the custom property the rule uses.
    const node = document.querySelector('[data-profile-slider="cpu"]'), cs = getComputedStyle(node), pick = name => resolveColor(node, 'var(' + name + ')');
    const track = node.querySelector('.fp-slider__track'), input = node.querySelector('.fp-slider__input'), bubble = getComputedStyle(node.querySelector('.fp-slider__value'));
    const rail = getComputedStyle(track, '::before').backgroundColor;
    let thumbEdge = ''; for (const pseudo of ['::-webkit-slider-thumb', '::-moz-range-thumb']) { try { thumbEdge ||= getComputedStyle(input, pseudo).borderTopColor ?? ''; } catch { /* the other engine's pseudo-element */ } }
    const fillB = resolveColor(node, cs.getPropertyValue('--fp-fill-b')), edge = resolveColor(node, 'color-mix(in srgb, ' + cs.getPropertyValue('--fp-fill-b') + ' 80%, #000)');
    return { fillToRail: ratio(fillB, rail), edgeToRail: ratio(edge, rail), thumbEdgeToSurface: ratio(thumbEdge || pick('--rd-control'), pick('--rd-surface')), bubble: ratio(bubble.color, bubble.backgroundColor), thumbRead: Boolean(thumbEdge) };
  });
  const rows = [];
  for (const theme of THEMES) { await get(name => document.documentElement.setAttribute('data-ui-theme', name), theme); await pause(250); rows.push({ theme, ...(await contrastRow()) }); }
  if (isChrome) { await get(() => document.documentElement.setAttribute('data-ui-theme', 'system')); await opened.media({ colorScheme: 'dark' }); await pause(300); rows.push({ theme: 'system-dark', ...(await contrastRow()) }); await opened.screenshot(join(shots, 'device-dark.png')); evidence.screenshots.push('device-dark.png'); await opened.media({ colorScheme: 'light' }); }
  await get(() => document.documentElement.setAttribute('data-ui-theme', 'system')); await pause(250);
  for (const row of rows) {
    if (isChrome) assert.equal(row.thumbRead, true, row.theme + ': the thumb edge is read from the rendered thumb');
    assert.ok(row.fillToRail >= 3, row.theme + ': the green body keeps 3:1 against the empty rail (' + row.fillToRail.toFixed(2) + ')');
    assert.ok(row.edgeToRail >= 3, row.theme + ': the bar outline keeps 3:1 against the empty rail (' + row.edgeToRail.toFixed(2) + ')');
    assert.ok(row.thumbEdgeToSurface >= 3, row.theme + ': the thumb edge keeps 3:1 against the card (' + row.thumbEdgeToSurface.toFixed(2) + ')');
    assert.ok(row.bubble >= 4.5, row.theme + ': the value bubble text keeps 4.5:1 (' + row.bubble.toFixed(2) + ')');
    evidence.contrast.push({ ...row, fillToRail: Number(row.fillToRail.toFixed(2)), edgeToRail: Number(row.edgeToRail.toFixed(2)), thumbEdgeToSurface: Number(row.thumbEdgeToSurface.toFixed(2)), bubble: Number(row.bubble.toFixed(2)) });
  }
  await opened.screenshot(join(shots, 'device-light.png')); evidence.screenshots.push('device-light.png');
  check('Contrast in ' + rows.map(row => row.theme).join(', ') + ': bar and outline >= 3:1 against the rail, thumb edge >= 3:1, bubble text >= 4.5:1');

  // ---- 7. Right to left: the bar grows from the right, the sparks use the mirrored gradient direction, the rails still line up.
  await openDevice('ar');
  for (const key of ['cpu', 'ram', 'screen']) await pick(key, 1); await pause(500);
  snapshot = await measure();
  for (const slider of snapshot.sliders) {
    assert.equal(slider.direction, 'rtl'); assert.equal(slider.dir, 'to left', slider.key + ': the body gradient runs towards the end of the bar');
    if (!slider.auto) { assert.equal(slider.fillRight, '0px', slider.key + ': the bar is anchored at the right edge'); assert.ok(Math.abs(slider.fillW - (11 + (slider.trackW - 22) * slider.ratio)) <= 1); }
  }
  for (const row of rowsOf(snapshot.sliders)) for (const slider of row) assert.ok(Math.abs(slider.track - row[0].track) <= 1, 'RTL: the rails of ' + row.map(item => item.key).join('/') + ' are on one line');
  check('RTL (Arabic): the bar grows from the right edge to the thumb, the rails still share their lines');
  // The draft lives only in the page and goes with it; nothing was applied.
  evidence.result = 'PASS';
}

try {
  await main();
} catch (failure) {
  evidence.result = 'FAIL'; evidence.failure = failure?.message ?? String(failure); throw failure;
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await opened?.close();
  console.log((evidence.result === 'PASS' ? 'PASS ' : 'FAIL ') + browser + ': ' + evidence.checks.length + ' checks, ' + evidence.alignment.length + ' alignment rows, ' + evidence.fills.length + ' fill rows, ' + evidence.contrast.length + ' contrast rows; evidence in ' + run);
}
