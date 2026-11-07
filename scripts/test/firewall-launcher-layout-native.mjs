// Targeted native UI proof. Fixture responses exist only in this test's init script and explicit test URLs.
// Builds nothing; run after the production owner has finished dist/chrome.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..');
const distIndex = process.argv.indexOf('--dist');
const extensionInput = distIndex < 0 ? join(root, 'dist/chrome') : resolve(process.argv[distIndex + 1]);
const quick = process.argv.includes('--quick');
const languagesIndex = process.argv.indexOf('--languages');
const requestedLanguages = languagesIndex < 0 ? null : [...new Set(process.argv[languagesIndex + 1].split(','))];
if (requestedLanguages) for (const id of requestedLanguages) assert.ok(PRODUCTION_LANGUAGES.some(value => value.id === id), 'unknown test language:' + id);
const languages = requestedLanguages ? PRODUCTION_LANGUAGES.filter(value => requestedLanguages.includes(value.id)) : quick ? PRODUCTION_LANGUAGES.filter(value => ['ru', 'en', 'ar'].includes(value.id)) : PRODUCTION_LANGUAGES;
const launcherCatalog = JSON.parse(readFileSync(join(root, 'apps/production-protect/src/locales/firewall-launcher.json'), 'utf8'));
for (const language of PRODUCTION_LANGUAGES) {
  for (const [key, entry] of Object.entries(launcherCatalog[language.id] ?? {})) assert.ok(!entry.message.includes('?'), language.id + '/' + key + ': replacement question marks in launcher translation');
}
const artifact = join(root, 'test-results/production-1.1.0/firewall-launcher');
mkdirSync(artifact, { recursive: true });
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/firewall-launcher-'));
// The release owner may rebuild the deterministic dist concurrently. Freeze this run's owned native input first.
const extension = join(run, 'extension');
cpSync(extensionInput, extension, { recursive: true });
const built = await build({ entryPoints: [join(root, 'vendor/protect-722fae8/packages/ui/test/protect-firewall-support.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { fwState } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixtures = {
  off: fwState({ state: 'off', consentVersion: null, features: [], decisions: 0 }),
  active: fwState(),
  degraded: fwState({ state: 'degraded', degradedReasons: ['blocking-unavailable'] }),
};
const evidence = { at: new Date().toISOString(), browser: null, scope: languages.length + ' locales × 2 inspector surfaces × 3 module states × 2 themes; owned test profile; production scripts unchanged', matrix: [], screenshots: [], checks: [], errors: [], result: 'RUNNING' };
evidence.input = { source: extensionInput, files: Object.fromEntries(['manifest.json', 'protect-ui.js', 'protect.css', 'protection-ui.css', 'popup.js', 'sidepanel.js', 'options.js', 'guard-launchers-ui.js', 'guard-launcher-controller.js', 'protection-ui.js', 'api-configuration.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const context = await chromium.launchPersistentContext(join(run, 'profile'), {
  channel: 'chromium', headless: true, viewport: { width: 412, height: 900 },
  args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
});
evidence.browser = context.browser()?.version() ?? null;
context.on('page', page => page.on('pageerror', error => evidence.errors.push({ url: page.url(), error: error.message })));
await context.addInitScript(({ fixtures }) => {
  if (location.protocol !== 'chrome-extension:') return;
  const fixture = new URLSearchParams(location.search).get('launcherfixture');
  if (!fixture || !Object.hasOwn(fixtures, fixture)) return;
  const state = fixtures[fixture];
  const audit = { reads: 0, writes: [], otherReads: [] };
  window.__launcherFixtureAudit = audit;
  const native = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message, ...rest) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('ui-protect-')) return native(message, ...rest);
    let response;
    switch (message.type) {
      case 'ui-protect-get-state': audit.reads++; response = { schemaVersion: 1, type: 'protect-state', state }; break;
      case 'ui-protect-get-report': response = { schemaVersion: 1, type: 'protect-report', report: null }; break;
      case 'ui-protect-list-rules': response = { schemaVersion: 1, type: 'protect-rules', total: 0, rows: [], preset: 'normal', stoppedDays: [] }; break;
      default:
        if (/^ui-protect-(?:enable|disable|set-|purge|decide|undo|dismiss|snooze|create|remove|delete|clear|cancel)/.test(message.type)) audit.writes.push(message.type);
        else audit.otherReads.push(message.type);
        response = { schemaVersion: 1, type: 'error', code: 'invalid-request' };
    }
    const callback = rest.at(-1);
    if (typeof callback === 'function') { queueMicrotask(() => callback(response)); return; }
    return Promise.resolve(response);
  };
}, { fixtures });

const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const base = new URL('.', worker.url()).href;
const sizes = { popup: { width: 412, height: 900 }, sidepanel: { width: 420, height: 1000 } };
let currentLabel = 'startup';

async function layout(page, { label, language, state }) {
  await page.locator('.inspector-tools [data-protection-launcher]').waitFor();
  await page.locator('.inspector-tools [data-protect-launcher]').waitFor();
  await page.locator('.inspector-tools [data-antidetect-launcher]').waitFor();
  await page.locator('.inspector-tools [data-dpi-guard-launcher]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-antidetect-launcher-master]')?.disabled === false);
  await page.waitForFunction(value => document.querySelector('[data-protect-launcher] [data-protect-state]')?.getAttribute('data-protect-state') === value, state);
  await page.locator('.inspector-tools').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const result = await page.evaluate(() => {
    const row = document.querySelector('.inspector-tools');
    const antidetect = row.querySelector('[data-antidetect-launcher]');
    const api = row.querySelector('[data-protection-launcher]');
    const dpi = row.querySelector('[data-dpi-guard-launcher]');
    const firewall = row.querySelector('[data-protect-launcher]');
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const failures = [], labels = [];
    const cards = [antidetect, api, dpi, firewall], boxes = cards.map(rect);
    // ADR-103: one grouped column — Защита (API Guard, Firewall, DPI Guard), then Атака (Antidetect).
    for (const [upper, lower, name] of [[1, 3, 'API Guard/Firewall'], [3, 2, 'Firewall/DPI Guard'], [2, 0, 'DPI Guard/Antidetect']]) {
      if (boxes[lower].y < boxes[upper].bottom - 0.5) failures.push('guard rows overlap or are out of order: ' + name);
      if (Math.abs(boxes[lower].x - boxes[upper].x) > 1.5) failures.push('guard rows leave the shared column: ' + name);
    }
    const [defense, attack] = ['defense', 'attack'].map(id => row.querySelector('[data-inspector-tools-group="' + id + '"]'));
    const precedes = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!precedes(defense, api) || !precedes(dpi, attack) || !precedes(attack, antidetect)) failures.push('guard group labels are out of place');
    if (boxes.some(box => Math.abs(box.width - boxes[0].width) > 1.5)) failures.push('cards have unequal widths');
    if (boxes.some(box => Math.abs(box.height - boxes[0].height) > 1.5)) failures.push('cards have unequal heights');
    const actualOrder = [...row.querySelectorAll('[data-antidetect-launcher],[data-protection-launcher],[data-dpi-guard-launcher],[data-protect-launcher]')];
    if (actualOrder.some((card, index) => card !== [api, firewall, dpi, antidetect][index])) failures.push('guard cards have the wrong document order');
    const dpiControls = [...dpi.querySelectorAll('button')];
    if (dpiControls.length !== 2 || dpiControls.some(control => !control.disabled)) failures.push('DPI Guard controls are not disabled');
    if (dpi.querySelector('[role="switch"]')?.getAttribute('aria-checked') !== 'false' || dpi.querySelector('[role="switch"]')?.textContent.trim() !== 'OFF') failures.push('DPI Guard has a false active state');
    for (const [index, card] of cards.entries()) {
      const box = boxes[index];
      if (card.scrollWidth > card.clientWidth + 2) failures.push('card overflows horizontally:' + index);
      const controls = [...card.querySelectorAll('button,a[href]')].filter(element => element.getBoundingClientRect().width > 0);
      const controlBoxes = controls.map(rect);
      for (let i = 0; i < controls.length; i++) {
        const control = controls[i], b = controlBoxes[i];
        if (b.x < box.x - 1.5 || b.right > box.right + 1.5 || b.y < box.y - 1.5 || b.bottom > box.bottom + 1.5) failures.push('button outside card:' + index + ':' + i);
        if (parseFloat(getComputedStyle(control).fontSize) < 12) failures.push('button font below12:' + index + ':' + i);
        if (!(control.getAttribute('aria-label') || control.textContent.trim())) failures.push('button missing accessible name:' + index + ':' + i);
        for (const span of control.querySelectorAll('span')) {
          if (span.classList.contains('sr-only') || getComputedStyle(span).display === 'none') continue;
          const textBox = rect(span);
          if (textBox.x < b.x - 1.5 || textBox.right > b.right + 1.5 || textBox.y < b.y - 1.5 || textBox.bottom > b.bottom + 1.5) failures.push('visible label outside button:' + index + ':' + i);
          if ((index === 0 || index === 2 || index === 3) && i === 0 && span === control.firstElementChild && textBox.height > parseFloat(getComputedStyle(span).lineHeight) + 1.5) failures.push('guard brand wraps across lines:' + index);
          if (!span.classList.contains('blocking-launcher__chevron') && !span.classList.contains('blocking-master__dot')) {
            labels.push({ card: index, control: i, box: textBox, clientHeight: span.clientHeight, scrollHeight: span.scrollHeight, clientWidth: span.clientWidth, scrollWidth: span.scrollWidth });
            if (span.clientHeight > 0 && (span.scrollHeight > span.clientHeight + 2 || span.scrollWidth > span.clientWidth + 2)) failures.push('visible label clipped:' + index + ':' + i);
          }
        }
        for (let j = i + 1; j < controls.length; j++) {
          const c = controlBoxes[j];
          if (Math.min(b.right, c.right) - Math.max(b.x, c.x) > 1 && Math.min(b.bottom, c.bottom) - Math.max(b.y, c.y) > 1) failures.push('buttons overlap:' + index);
        }
      }
    }
    if (document.querySelector('#popup-protect-status,.protect-launcher__desc')) failures.push('obsolete standalone status/card remains');
    // ADR-111: only the Options shell hands the launcher a toolSlot (its Tour button between the title and the switch); here the row is exactly the title and the switch, as before.
    const launcherRow = [...firewall.querySelector('.blocking-launcher__controls').children].map(child => child.tagName.toLowerCase() + (child.hasAttribute('data-protect-open') ? ':open' : child.getAttribute('role') === 'switch' ? ':switch' : ':other'));
    if (JSON.stringify(launcherRow) !== '["button:open","button:switch"]') failures.push('the Firewall launcher row is not exactly its title and its switch: ' + JSON.stringify(launcherRow));
    if (document.querySelector('[data-ui-tour-start]')) failures.push('a Tour button on a page without a tour layer');
    const text = row.textContent.trim();
    if (/\b(?:firewall_launcher|protect_state|protection_title|protect_launcher|guard_launcher)_[a-z_]+\b/.test(text)) failures.push('untranslated catalog key');
    return { failures, boxes, labels, row: rect(row), direction: getComputedStyle(row).direction, firewallDirection: getComputedStyle(firewall).direction, firewallLang: firewall.lang,
      text, statusText: firewall.querySelector('.protect-launcher__state')?.textContent.trim(),
      statusLabel: firewall.querySelector('[data-protect-state]')?.getAttribute('aria-label'),
      statusTitle: firewall.querySelector('[data-protect-state]')?.getAttribute('title'),
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      audit: window.__launcherFixtureAudit ?? null };
  });
  assert.deepEqual(result.failures, [], label + ': ' + result.failures.join(', '));
  assert.equal(result.documentOverflow, false, label + ': page horizontal overflow');
  const expectedDir = ['ar', 'ur'].includes(language.id) ? 'rtl' : 'ltr';
  assert.equal(result.direction, expectedDir, label + ': row direction');
  assert.equal(result.firewallDirection, expectedDir, label + ': Firewall direction');
  assert.doesNotThrow(() => Intl.getCanonicalLocales(result.firewallLang), label + ': valid BCP47 lang');
  assert.equal(result.firewallLang.toLowerCase(), language.id.replaceAll('_', '-').toLowerCase(), label + ': launcher language');
  if (result.audit) assert.deepEqual(result.audit.writes, [], label + ': launcher caused a privileged mutation');
  const table = launcherCatalog[language.id];
  for (const brand of ['Antidetect', 'API Guard', 'DPI Guard']) assert.ok(result.text.includes(brand), label + ': visible ' + brand + ' brand');
  assert.ok(result.text.includes(table.firewall_launcher_title.message), label + ': localized Firewall title');
  const stateKey = state === 'off' ? 'protect_state_off' : state === 'active' ? 'protect_state_active' : 'protect_state_degraded';
  assert.ok([result.statusLabel, result.statusTitle].some(value => value?.includes(table[stateKey].message)), label + ': full localized state');
  if (state !== 'degraded') assert.equal(result.statusText, state === 'active' ? 'ON' : 'OFF', label + ': shared ON/OFF indicator');
  return result;
}

async function screenshot(page, label, row) {
  const file = label.replaceAll('/', '-') + '.png';
  const clip = { x: Math.max(0, Math.floor(row.x) - 3), y: Math.max(0, Math.floor(row.y) - 3), width: Math.ceil(row.width) + 6, height: Math.ceil(row.height) + 6 };
  clip.width = Math.min(clip.width, page.viewportSize().width - clip.x);
  const bytes = await page.screenshot({ path: join(artifact, file), clip });
  evidence.screenshots.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function keyboardDestination(page, selector, expected) {
  const prior = new Set(context.pages());
  await page.locator(selector).focus();
  assert.equal(await page.locator(selector).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  const deadline = Date.now() + 10000;
  let destination;
  while (Date.now() < deadline) {
    destination = context.pages().find(candidate => (candidate === page || !prior.has(candidate)) && expected.test(candidate.url()));
    if (destination) break;
    await page.waitForTimeout(30);
  }
  assert.ok(destination, selector + ': keyboard action did not reach actual Settings route');
  await destination.waitForLoadState('domcontentloaded');
  return destination;
}

// ADR-088/103: below 1120 px the management navigation is collapsed behind its menu button, so in this 412 px test window the
// selected tab button is attached but not rendered. The route is therefore proven by the selected tab state plus the visible
// panel at the narrow width, and by the visible selected tab itself once the window is a desktop one.
async function assertManagementRoute(destination, id, label) {
  const selected = destination.locator('[data-management-tab="' + id + '"][aria-selected="true"]');
  await selected.waitFor({ state: 'attached' });
  await destination.locator('#management-panel-' + id).waitFor();
  assert.equal(await destination.locator('[data-management-tab][aria-selected="true"]').count(), 1, label + ': exactly one selected management tab');
  await destination.setViewportSize({ width: 1280, height: 900 });
  await selected.waitFor();
  assert.equal(await destination.locator('#management-panel-' + id).isVisible(), true, label + ': panel stays visible in a desktop window');
}

try {
  const page = await context.newPage();
  await page.goto(base + 'options.html');
  await page.locator('.language-picker__trigger').waitFor();
  await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }));
  for (const language of languages) {
    await page.evaluate(value => chrome.storage.local.set({ 'ui-language-v1': value }), language.id);
    for (const [surface, size] of Object.entries(sizes)) {
      await page.setViewportSize(size);
      for (const state of Object.keys(fixtures)) {
        await page.goto(base + surface + '.html?launcherfixture=' + state);
        for (const theme of ['light', 'dark']) {
          currentLabel = language.id + '/' + surface + '/' + state + '/' + theme;
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          const result = await layout(page, { label: currentLabel, language, state });
          evidence.matrix.push({ label: currentLabel, ...result });
          await screenshot(page, currentLabel, result.row);
        }
      }
    }
    console.log('launcher layout: ' + language.id + ' ' + evidence.matrix.length + ' cases checked');
  }
  evidence.checks.push('all requested locale/theme/state/surface geometry cases passed');

  // Real service worker and real activation (ADR-098: one explicit click, no dialog); no fixture response participates in these pages.
  currentLabel = 'actual Chrome activation, toggles and routes';
  await page.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'en' }));
  await page.setViewportSize(sizes.popup);
  await page.goto(base + 'popup.html');
  const realState = () => page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-get-state' }));
  assert.equal((await realState()).state.state, 'off');
  await layout(page, { label: 'actual/off', language: PRODUCTION_LANGUAGES.find(value => value.id === 'en'), state: 'off' });
  const master = page.locator('[data-protection-master]');
  await page.waitForFunction(() => document.querySelector('[data-protection-master]')?.disabled === false);
  assert.equal(await master.getAttribute('aria-checked'), 'false');
  for (const enabled of [true, false]) {
    await master.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(value => {
      const control = document.querySelector('[data-protection-master]');
      return control?.getAttribute('aria-checked') === String(value) && !control.disabled;
    }, enabled);
    const stored = await page.evaluate(() => chrome.storage.local.get('protection:v1'));
    assert.equal(stored['protection:v1'].enabled, enabled, 'actual API master persists selected state');
    const configuration = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }));
    assert.equal(configuration.configuration.antidetectEnabled, false, 'actual API master leaves Antidetect OFF');
    assert.equal((await realState()).state.state, 'off', 'API master does not enable Firewall');
  }
  evidence.checks.push('actual API master toggles with keyboard Space, persists On/Off and leaves Firewall off');
  // A successful enable legitimately opens an activation toast in another page.
  // Track Settings destinations so its asynchronous creation/cleanup cannot race this assertion.
  const settingsPages = () => context.pages().map(candidate => candidate.url()).filter(value => {
    const url = new URL(value);
    return url.protocol === 'chrome-extension:' && url.host === new URL(base).host && ['/options.html', '/protection.html'].includes(url.pathname);
  }).sort();
  const firewall = await keyboardDestination(page, '[data-protect-open]', /\/options\.html(?:\?[^#]*)?#(?:protect|firewall)$/);
  await assertManagementRoute(firewall, 'firewall', 'Firewall launcher route');
  assert.equal((await realState()).state.state, 'off', 'opening Firewall settings never enables the module');
  await firewall.close();
  evidence.checks.push('large Firewall launcher opens the canonical management tab with keyboard Enter and leaves the module OFF');
  // ADR-098: one explicit Enter on the compact switch is the whole activation; the dialog and the acknowledgement no longer exist.
  const activationDialogs = '#firewall-launcher-consent, [data-protect-inline-consent], [data-consent-confirm], dialog[open], [aria-modal="true"]';
  const beforeEnableSettings = settingsPages(), beforeEnableUrl = page.url();
  assert.equal(await page.locator(activationDialogs).count(), 0, 'the OFF launcher shows no activation dialog');
  await page.locator('[data-protect-settings]').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(async () => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-get-state' })).state.state === 'active');
  const activated = (await realState()).state;
  assert.deepEqual(activated.features, ['value-match', 'firewall', 'session-replay'], 'first activation uses the canonical initial features'); assert.equal(activated.preset, 'normal');
  assert.equal(activated.consentVersion, activated.requiredConsentVersion, 'activation records the current consent version');
  assert.equal(await page.locator(activationDialogs).count(), 0, 'enable shows no activation dialog or acknowledgement');
  assert.equal(page.url(), beforeEnableUrl); assert.deepEqual(settingsPages(), beforeEnableSettings, 'enable does not open Settings');
  evidence.checks.push('compact Firewall switch enables the actual module with one keyboard Enter: canonical initial choices, no dialog or acknowledgement, no Options navigation');
  await page.reload();
  const enabledLayout = await layout(page, { label: 'actual/active', language: PRODUCTION_LANGUAGES.find(value => value.id === 'en'), state: 'active' });
  await screenshot(page, 'actual-chrome-active', enabledLayout.row);
  evidence.checks.push('actual Chrome activation enables module; Antidetect/API Guard and DPI Guard/Firewall keep two rows; old status card absent');
  await page.locator('[data-protect-settings]').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-protect-launcher]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-protect-settings]')?.getAttribute('aria-checked') === 'false');
  assert.equal((await realState()).state.state, 'off');
  assert.equal(page.url(), beforeEnableUrl); assert.deepEqual(settingsPages(), beforeEnableSettings, 'disable does not open Settings');
  evidence.checks.push('active Firewall status button turns the actual module OFF with keyboard Enter without navigation');
  const api = await keyboardDestination(page, '[data-protection-open]', /\/options\.html(?:\?[^#]*)?#api$/);
  await assertManagementRoute(api, 'api', 'API launcher route');
  await api.locator('[data-api-configuration-editor]').waitFor({ state: 'attached' });
  evidence.checks.push('API launcher reaches actual API Settings with keyboard Enter');
  await api.close();
  await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }));
  assert.deepEqual(evidence.errors, [], 'no page errors');
  evidence.result = 'PASS';
  console.log('PASS launcher layout: ' + evidence.matrix.length + ' matrix cases, ' + evidence.checks.length + ' native checks');
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = { label: currentLabel, error: String(error.stack ?? error) };
  console.error(JSON.stringify(evidence.failure, null, 2));
  process.exitCode = 1;
} finally {
  writeFileSync(join(artifact, 'layout.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close();
}
