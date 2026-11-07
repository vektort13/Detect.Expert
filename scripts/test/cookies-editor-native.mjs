// ADR-069 addendum 2026-11-07 (owner's order): the cookie editor dialog (every attribute, read-only details, identity lock and copy, the Unix-seconds <-> date/time
// converter) in a real, owned, disposable browser, with the extension staged FROM SOURCE into a private run folder (.tmp/cookies-editor-<browser>-*; never dist/ or
// release/). Cookies are seeded with the browser's own cookies API on the throwaway profile; no user data is read.
//   node scripts/test/cookies-editor-native.mjs             Chrome (Playwright Chromium; the time zone is overridden through CDP for the DST checks)
//   node scripts/test/cookies-editor-native.mjs --firefox   Firefox (WebDriver; the DST checks run only when this Firefox honours the TZ variable)
// Evidence (evidence.json and screenshots/) stays in the run folder.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', isChrome = browser === 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cookies-editor-' + browser + '-')), extension = join(run, 'extension'), shots = join(run, 'screenshots');
mkdirSync(shots, { recursive: true });
await stageExtension({ browser, target: extension, from: 'source' });
// Private copy only: the optional cookies permission is granted in its manifest, as the Cookies native does for its owned fixture.
const manifestFile = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== 'cookies'); manifest.permissions.push('cookies');
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
// Firefox gets its time zone from the TZ variable when it honours it (the check below tells); Chrome is overridden through CDP later.
if (!isChrome) process.env.TZ = 'America/New_York';
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: 'source', result: 'RUNNING', checks: [], layouts: [], screenshots: [], notes: [] };
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };
let opened = null;
// WebDriver answers null while a document is being replaced; that surfaces as a TypeError in the shared fixture. Retry only that, a few times.
const get = async (fn, value) => { for (let attempt = 0; ; attempt++) { try { return await opened.evaluate(fn, value); } catch (error) { if (!(error instanceof TypeError) || attempt >= 4) throw error; await pause(400); } } };
const THEMES = Object.freeze({ light: 'pearl', dark: 'graphite' });
const sel = Object.freeze({ unix: '[data-cookies-field="expirationDate"]', date: '[data-cookies-datetime]', forward: '[data-cookies-convert="forward"]', back: '[data-cookies-convert="back"]', zone: '[data-cookies-zone]', save: '[data-cookies-save]', cancel: '[data-cookies-cancel]' });
const ready = () => get(() => document.querySelector('[data-cookies-workspace]')?.getAttribute('aria-busy') === 'false');
const value = selector => get(selector => document.querySelector(selector)?.value ?? null, selector);
const converterError = () => get(() => { const node = document.querySelector('[data-cookies-converter-error]'); return node ? { code: node.getAttribute('data-cookies-converter-error'), text: node.textContent, role: node.getAttribute('role') } : null; });
const setSelect = (selector, next) => get(({ selector, next }) => { const node = document.querySelector(selector); node.value = next; node.dispatchEvent(new Event('change', { bubbles: true })); }, { selector, next });

let loads = 0;
async function language(id, theme = 'light', { reload = true } = {}) {
  await get(async ({ id, theme }) => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ 'ui-language-v1': id, 'ui-theme-v1': theme }); try { localStorage.setItem('ui-theme-v1', theme); } catch { /* optional cache */ } }, { id, theme: THEMES[theme] });
  if (reload) { await opened.goto(opened.base + 'options.html?run=' + (++loads) + '#cookies'); await until(() => get(() => document.querySelector('[data-management-tab="cookies"]')?.getAttribute('aria-selected') === 'true'), 'Cookies tab'); }
  await until(() => get(({ expected, theme }) => (document.querySelector('[data-management-shell]')?.lang ?? document.documentElement.lang).toLowerCase() === expected && (!theme || document.documentElement.getAttribute('data-ui-theme') === theme), { expected: id.replace('_', '-').toLowerCase(), theme: reload ? THEMES[theme] : null }), 'language ' + id + ' / ' + theme);
  await until(ready, 'ready after language ' + id);
}
async function openList(name) {
  if (await get(() => Boolean(document.querySelector('[data-cookies-dialog]')))) { await opened.click(sel.cancel); await until(() => get(() => !document.querySelector('[data-cookies-dialog]')), 'dialog closed'); }
  await until(ready, 'workspace ready'); await opened.click('[data-cookies-load]'); await until(ready, 'refreshed');
  await opened.fill('[data-cookies-search]', name);
  return until(() => get(name => { const rows = [...document.querySelectorAll('[data-cookies-record]')]; return rows.length === 1 && rows[0].textContent.includes(name) ? rows[0].getAttribute('data-cookies-record') : null; }, name), 'one row for ' + name);
}
async function openEditor(name) {
  const row = await openList(name);
  await opened.click('[data-cookies-edit="' + row + '"]');
  await until(() => get(() => Boolean(document.querySelector('[data-cookies-dialog="editor"]'))), 'editor for ' + name);
  await get(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}
const nativeCookie = name => get(async ({ name, firefox }) => { const api = globalThis.browser ?? globalThis.chrome; const all = await api.cookies.getAll({ domain: 'example.com', partitionKey: {}, ...(firefox ? { firstPartyDomain: null } : {}) }); return all.filter(cookie => cookie.name === name).map(cookie => ({ ...cookie })); }, { name, firefox: !isChrome });
const scrollTo = (selector, block = 'center') => get(({ selector, block }) => document.querySelector(selector).scrollIntoView({ block }), { selector, block });
const shot = async name => { const path = join(shots, name + '.png'); if (isChrome) await opened.context.pages().find(page => page.url().startsWith(opened.base)).screenshot({ path }); else await opened.screenshot(path); evidence.screenshots.push(name + '.png'); };

// Everything the layout checks need, in one self-contained page function.
const measure = () => get(() => {
  const box = selector => { const node = document.querySelector(selector); if (!node) return null; const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
  const dialog = document.querySelector('[data-cookies-dialog="editor"]'), form = dialog.querySelector('form');
  const matrix = selector => { const icon = document.querySelector(selector + ' svg'); return icon ? getComputedStyle(icon).transform : null; };
  const input = document.querySelector('[data-cookies-datetime]');
  return { innerWidth, innerHeight, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1, dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1, direction: getComputedStyle(dialog).direction,
    formContent: form.clientWidth - parseFloat(getComputedStyle(form).paddingLeft) - parseFloat(getComputedStyle(form).paddingRight),
    dialog: box('[data-cookies-dialog="editor"]'), unix: box('[data-cookies-field="expirationDate"]'), date: box('[data-cookies-datetime]'), forward: box('[data-cookies-convert="forward"]'), back: box('[data-cookies-convert="back"]'), zone: box('[data-cookies-zone]'), details: box('[data-cookies-details]'), save: box('[data-cookies-save]'), actions: box('.cookies-workspace-editor > .cookies-workspace-dialog-actions'),
    dateClipped: input.scrollWidth > input.clientWidth + 1, forwardTransform: matrix('[data-cookies-convert="forward"]'), backTransform: matrix('[data-cookies-convert="back"]'),
    lockNote: Boolean(document.querySelector('[data-cookies-lock-note]')), unresolved: /cookies_workspace_|browser_debug_|\$[A-Z]+\$|undefined/.test(dialog.textContent) };
});
// WCAG contrast of the text of one element against the first opaque background above it.
const contrast = selector => get(selector => {
  const parse = text => { const numbers = (text.match(/-?[\d.]+/g) ?? []).map(Number); if (text.startsWith('color(')) return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255, numbers.length > 3 ? numbers[3] : 1]; return [numbers[0], numbers[1], numbers[2], numbers.length > 3 ? numbers[3] : 1]; };
  const over = (top, below) => [0, 1, 2].map(index => top[index] * top[3] + below[index] * (1 - top[3])).concat(1);
  const luminance = color => { const [r, g, b] = color.slice(0, 3).map(channel => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const element = document.querySelector(selector); if (!element) return null;
  const layers = []; for (let node = element; node; node = node.parentElement) { const background = parse(getComputedStyle(node).backgroundColor); if (background[3] > 0) layers.push(background); if (background[3] >= 0.99) break; }
  let backdrop = [255, 255, 255, 1]; for (const layer of layers.reverse()) backdrop = over(layer, backdrop);
  const foreground = over(parse(getComputedStyle(element).color), backdrop), light = Math.max(luminance(foreground), luminance(backdrop)), dark = Math.min(luminance(foreground), luminance(backdrop));
  return (light + 0.05) / (dark + 0.05);
}, selector);

async function main() {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, userScripts: false });
  evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#cookies');
  await until(() => get(() => document.querySelector('[data-management-tab="cookies"]')?.getAttribute('aria-selected') === 'true'), 'Cookies tab');
  await until(ready, 'Cookies ready'); await until(() => get(() => Boolean(document.querySelector('[data-cookies-load]')) && !document.querySelector('[data-cookies-load]').disabled), 'granted access');
  await language('en', 'light');

  // ---- 0. Seed three cookies on the throwaway profile through the browser's own cookies API.
  const expiry = Math.floor(Date.now() / 1000) + 60 * 86400 + 0.97721;
  const seeded = await get(async ({ expiry, firefox }) => {
    const api = globalThis.browser ?? globalThis.chrome, url = 'https://owned-editor.example.com/';
    await api.cookies.set({ url: url + 'shop', name: 'owned-editor-a', value: 'OWNED_EDITOR_VALUE', domain: 'example.com', path: '/shop', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: expiry });
    await api.cookies.set({ url, name: 'owned-editor-b', value: 'SESSION_VALUE', path: '/', secure: false, httpOnly: false, sameSite: 'lax' });
    await api.cookies.set({ url, name: 'owned-editor-c', value: 'PARTITION_VALUE', path: '/', secure: true, sameSite: 'no_restriction', expirationDate: expiry, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } });
    const all = await api.cookies.getAll({ domain: 'example.com', partitionKey: {}, ...(firefox ? { firstPartyDomain: null } : {}) });
    return Object.fromEntries(all.filter(cookie => cookie.name.startsWith('owned-editor-')).map(cookie => [cookie.name.slice(-1), cookie]));
  }, { expiry, firefox: !isChrome });
  assert.deepEqual(Object.keys(seeded).sort(), ['a', 'b', 'c']);
  const unix0 = String(seeded.a.expirationDate); evidence.seeded = { requested: expiry, returnedByBrowser: seeded.a.expirationDate };
  check('three owned cookies were seeded through the browser API (persistent domain cookie, session cookie, partitioned cookie); the browser returns expirationDate ' + unix0);

  // ---- 1. The persistent cookie: every attribute and the read-only details are in the dialog.
  await openEditor('owned-editor-a');
  const form = await get(() => {
    const read = key => document.querySelector('[data-cookies-field="' + key + '"]'), detail = key => document.querySelector('[data-cookies-detail="' + key + '"] dd')?.textContent ?? null;
    return { name: read('name').value, domain: read('domain').value, path: read('path').value, storeId: read('storeId').value, value: read('value').value, sameSite: read('sameSite').value, unix: read('expirationDate').value, date: document.querySelector('[data-cookies-datetime]').value,
      checks: ['hostOnly', 'secure', 'httpOnly', 'session', 'partitioned'].map(key => read(key).checked), sameSiteOptions: [...read('sameSite').options].map(option => [option.value, option.disabled]), ancestorOptions: [...read('partitionAncestor').options].map(option => [option.value, option.disabled]),
      locked: Object.fromEntries(['name', 'domain', 'path', 'storeId', 'hostOnly', 'partitioned', 'partitionTopLevelSite', 'partitionAncestor', 'firstPartyDomain'].map(key => [key, read(key).disabled])), editable: Object.fromEntries(['value', 'sameSite', 'expirationDate', 'secure', 'httpOnly', 'session'].map(key => [key, !read(key).disabled])),
      details: { expires: detail('expires'), size: detail('size'), host: detail('host'), path: detail('path'), connection: detail('connection') }, lockNote: document.querySelector('[data-cookies-lock-note]')?.textContent ?? null, copyButton: Boolean(document.querySelector('[data-cookies-copy-as-new]')),
      limitsNote: document.querySelector('[data-cookies-details] > p')?.textContent ?? null, title: document.querySelector('#cookies-dialog-title').textContent, zoneOptions: [...document.querySelector('[data-cookies-zone]').options].map(option => option.textContent), hints: [...document.querySelectorAll('.cookies-workspace-hint')].map(node => node.textContent) };
  });
  evidence.form = form;
  assert.deepEqual({ name: form.name, domain: form.domain, path: form.path, value: form.value, sameSite: form.sameSite, unix: form.unix }, { name: 'owned-editor-a', domain: '.example.com', path: '/shop', value: 'OWNED_EDITOR_VALUE', sameSite: 'no_restriction', unix: unix0 });
  assert.deepEqual(form.checks, [false, true, true, false, false], 'domain cookie, Secure, HttpOnly, persistent, not partitioned');
  assert.equal(form.sameSiteOptions.length, 4); if (isChrome) assert.deepEqual(form.sameSiteOptions.filter(([, disabled]) => disabled), [], 'Chrome offers all four SameSite choices');
  for (const [key, disabled] of Object.entries(form.locked)) assert.equal(disabled, true, key + ' is an identity field and is locked');
  for (const [key, editable] of Object.entries(form.editable)) assert.equal(editable, true, key + ' stays editable');
  assert.match(form.date, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d:\d\d$/); assert.equal(form.date.split(/[+-]\d\d:\d\d$/)[0].split('.')[1] ?? '', unix0.split('.')[1] ?? '', 'the date keeps every fraction digit of the Unix value');
  assert.match(form.details.expires, /\d{4}.* · in \d+ (?:days?|months?)$/); assert.equal(form.details.host, 'example.com and all its subdomains'); assert.equal(form.details.path, '/shop and everything below it'); assert.equal(form.details.connection, 'HTTPS only');
  if (isChrome) assert.match(form.details.size, /^\d+ of 4096 B allowed/); else assert.match(form.details.size, /^\d+ B \(name and value\)$/);
  assert.match(form.lockNote, /cannot be changed/); assert.equal(form.copyButton, true); assert.match(form.limitsNote, /creation time, last access, priority, source scheme or source port/); assert.equal(form.title, 'Edit cookie');
  assert.equal(form.zoneOptions[0].startsWith('Local time (UTC'), true); assert.equal(form.zoneOptions[1], 'UTC');
  check('the dialog shows every attribute of the cookie, locks the identity fields with an explanation and a copy button, and lists expiry, size, host, path and connection');

  // ---- 2. Real round trip: Unix seconds -> date and time -> Unix seconds gives back the digits the browser reported.
  const localDate = await get(() => document.querySelector('[data-cookies-datetime]').value);
  await opened.fill(sel.date, '2020-01-01 00:00:00Z'); assert.equal(await value(sel.unix), unix0, 'typing in the date field does not touch the Unix seconds');
  await opened.click(sel.forward); await until(async () => (await value(sel.date)) === localDate, 'forward arrow converts Unix seconds into the date field');
  await opened.fill(sel.unix, ''); assert.equal((await until(converterError, 'empty Unix field flagged')).code, 'seconds:empty', 'an empty Unix field is flagged at once'); assert.equal(await value(sel.date), localDate, 'clearing the Unix field does not touch the date field');
  await opened.click(sel.back); await until(async () => (await value(sel.unix)) === unix0, 'back arrow gives the original Unix text');
  assert.equal(await converterError(), null);
  await setSelect(sel.zone, 'utc'); await opened.click(sel.forward);
  const utcDate = await until(async () => { const text = await value(sel.date); return text.endsWith('Z') ? text : null; }, 'UTC date with Z');
  await opened.fill(sel.unix, ''); await opened.click(sel.back); await until(async () => (await value(sel.unix)) === unix0, 'UTC round trip');
  assert.equal(Date.parse(utcDate.replace(' ', 'T').replace(/(\.\d+)?Z$/, 'Z')) / 1000, Math.floor(Number(unix0)), 'the UTC text is the same instant');
  await setSelect(sel.zone, 'local');
  check('round trip with the real browser value: ' + unix0 + ' -> ' + localDate + ' -> ' + unix0 + ' and -> ' + utcDate + ' -> ' + unix0 + ' (no drift, nothing converts by itself)');

  // ---- 3. Errors: nothing changes, the message is an alert wired to the field.
  await opened.fill(sel.date, 'not a date'); await opened.click(sel.back);
  const bad = await until(converterError, 'format error'); assert.equal(bad.code, 'datetime:format'); assert.equal(bad.role, 'alert'); assert.ok(bad.text.length > 10);
  assert.equal(await get(() => ({ invalid: document.querySelector('[data-cookies-datetime]').getAttribute('aria-invalid'), described: document.querySelector('[data-cookies-datetime]').getAttribute('aria-describedby') })).then(state => state.invalid + '|' + state.described), 'true|cookies-converter-hint cookies-converter-message');
  assert.equal(await value(sel.unix), unix0, 'a refused conversion changes nothing'); await scrollTo('[data-cookies-converter]'); await shot('state-converter-error-en-light-' + (await get(() => innerWidth)));
  await opened.fill(sel.date, '1970-01-01 00:00:00Z'); await opened.click(sel.back); assert.equal((await until(converterError, 'range error')).code, 'datetime:range');
  await opened.fill(sel.unix, 'abc'); assert.equal((await until(converterError, 'seconds error')).code.startsWith('seconds:'), true); await opened.click(sel.forward); assert.equal(await value(sel.date), '1970-01-01 00:00:00Z', 'nothing is converted from a bad Unix value');
  await opened.fill(sel.unix, unix0); await opened.fill(sel.date, '2030-01-01 00:00:00Z'); await opened.click(sel.save);
  assert.equal((await until(converterError, 'unapplied')).code, 'datetime:unapplied'); assert.equal(await get(() => Boolean(document.querySelector('[data-cookies-dialog="editor"]'))), true, 'Save refuses a typed but unconverted date');
  assert.equal(String((await nativeCookie('owned-editor-a'))[0].expirationDate), unix0, 'the cookie in the browser is untouched');
  check('bad dates, bad Unix values and an unconverted date show an inline alert (aria-invalid, aria-describedby), change nothing and keep Save from writing');

  // ---- 4. Convert a typed date with the arrow, Save, and read the cookie back from the browser.
  const target = await get(() => { const date = new Date(Date.now() + 100 * 86400000), pad = number => String(number).padStart(2, '0'); return { text: date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()) + ' 04:05:06.789Z', seconds: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 4, 5, 6) / 1000 + 0.789 }; });
  await opened.fill(sel.date, target.text); await opened.click(sel.back); await until(async () => Math.abs(Number(await value(sel.unix)) - target.seconds) < 1e-6, 'typed date converted to Unix seconds');
  await opened.click(sel.save); await until(() => get(() => !document.querySelector('[data-cookies-dialog]') && Boolean(document.querySelector('[data-cookies-result]'))), 'saved');
  const written = (await nativeCookie('owned-editor-a'))[0];
  assert.ok(Math.abs(written.expirationDate - target.seconds) < (isChrome ? 0.001 : 1.001), 'the browser stored the converted expiry (' + written.expirationDate + ' for ' + target.seconds + ')'); assert.equal(written.value, 'OWNED_EDITOR_VALUE'); assert.equal(written.httpOnly, true); assert.equal(written.secure, true);
  evidence.writtenExpiry = { asked: target.seconds, stored: written.expirationDate };
  // The result panel tells when the browser changed the expiry (Firefox keeps whole seconds); where nothing changed it counts zero.
  const adjusted = await get(() => [...document.querySelectorAll('[data-cookies-result] .cookies-workspace-counts > span')].find(span => span.textContent.includes('Adjusted by browser'))?.querySelector('strong')?.textContent ?? null);
  assert.equal(adjusted, isChrome ? '0' : '1', 'adjusted-by-browser count after saving ' + target.seconds + ' (stored ' + written.expirationDate + ')'); evidence.adjustedCount = adjusted;
  // Observation only: how far into the future this browser lets an expiry reach (Chrome limits cookie lifetime by its own policy).
  evidence.expiryReach = await get(async firefox => { const api = globalThis.browser ?? globalThis.chrome, now = Math.floor(Date.now() / 1000); await api.cookies.set({ url: 'https://owned-editor.example.com/', name: 'owned-editor-reach', value: 'x', secure: true, expirationDate: now + 700 * 86400 }); const stored = (await api.cookies.getAll({ domain: 'example.com', name: 'owned-editor-reach', partitionKey: {}, ...(firefox ? { firstPartyDomain: null } : {}) }))[0]; await api.cookies.remove({ url: 'https://owned-editor.example.com/', name: 'owned-editor-reach' }); return { requestedDays: 700, storedDays: stored ? Math.round((stored.expirationDate - now) / 86400) : null }; }, !isChrome);
  if (isChrome) assert.equal(evidence.expiryReach.storedDays, 400, 'Chrome stores a 700-day expiry as 400 days, which is what the editor announces (problem_reach)');
  check('a date typed in the date field, converted by the arrow and saved is the expiry the browser stores (' + target.seconds + ' -> ' + written.expirationDate + ')');

  // ---- 5. A session cookie has nothing to convert; a partitioned cookie shows its partition and the unsupported options carry their reason.
  await openEditor('owned-editor-b');
  const session = await get(() => ({ disabled: ['[data-cookies-convert="forward"]', '[data-cookies-convert="back"]', '[data-cookies-datetime]', '[data-cookies-field="expirationDate"]', '[data-cookies-zone]'].map(selector => document.querySelector(selector).disabled), session: document.querySelector('[data-cookies-field="session"]').checked, expires: document.querySelector('[data-cookies-detail="expires"] dd').textContent, connection: document.querySelector('[data-cookies-detail="connection"] dd').textContent, host: document.querySelector('[data-cookies-detail="host"] dd').textContent }));
  assert.deepEqual(session.disabled, [true, true, true, true, true]); assert.equal(session.session, true); assert.equal(session.expires, 'No expiry date: kept until the browser session ends'); assert.equal(session.connection, 'HTTP and HTTPS'); assert.equal(session.host, 'owned-editor.example.com only, not its subdomains');
  await opened.click('[data-cookies-field="session"]'); assert.deepEqual(await get(() => ['[data-cookies-convert="forward"]', '[data-cookies-convert="back"]', '[data-cookies-datetime]'].map(selector => document.querySelector(selector).disabled)), [false, false, false], 'unticking Session enables the converter');
  await opened.click(sel.cancel);
  await openEditor('owned-editor-c');
  const partition = await get(() => ({ site: document.querySelector('[data-cookies-field="partitionTopLevelSite"]').value, ancestor: document.querySelector('[data-cookies-field="partitionAncestor"]').value, partitioned: document.querySelector('[data-cookies-field="partitioned"]').checked, first: document.querySelector('[data-cookies-field="firstPartyDomain"]').value, firstDisabled: document.querySelector('[data-cookies-field="firstPartyDomain"]').disabled, hints: [...document.querySelectorAll('.cookies-workspace-hint')].map(node => node.textContent) }));
  assert.equal(partition.partitioned, true); assert.equal(partition.site, 'https://example.com'); assert.equal(partition.ancestor, 'false'); assert.equal(partition.firstDisabled, true);
  if (isChrome) assert.ok(partition.hints.includes('First-party domain: Unavailable in this browser.'), 'Chrome has no first-party domain and says so'); else assert.equal(partition.hints.includes('First-party domain: Unavailable in this browser.'), false);
  evidence.partitionHints = partition.hints;
  check('a session cookie disables both fields and both arrows until Session is unticked; a partitioned cookie shows its partition and unsupported options say why');

  // ---- 6. Copy as new: the identity unlocks, an unchanged identity is refused, a changed one creates a second cookie and leaves the original alone.
  await openEditor('owned-editor-a');
  await opened.click('[data-cookies-copy-as-new]');
  assert.deepEqual(await get(() => ({ title: document.querySelector('#cookies-dialog-title').textContent, locked: ['name', 'domain', 'path', 'storeId', 'hostOnly', 'partitioned'].map(key => document.querySelector('[data-cookies-field="' + key + '"]').disabled), note: document.querySelector('[data-cookies-copy-note]')?.textContent ?? null, lock: Boolean(document.querySelector('[data-cookies-lock-note]')) })).then(state => ({ ...state, note: Boolean(state.note) })), { title: 'Create cookie', locked: [false, false, false, false, false, false], note: true, lock: false });
  await opened.click(sel.save); await until(() => get(() => Boolean(document.querySelector('[data-cookies-error]'))), 'copy refused'); assert.equal((await nativeCookie('owned-editor-copy')).length, 0);
  await opened.fill('[data-cookies-field="name"]', 'owned-editor-copy'); await opened.click(sel.save); await until(() => get(() => !document.querySelector('[data-cookies-dialog]')), 'copy saved');
  const copy = (await nativeCookie('owned-editor-copy'))[0], original = (await nativeCookie('owned-editor-a'))[0];
  assert.ok(copy && original); assert.equal(copy.value, original.value); assert.equal(copy.path, original.path); assert.equal(copy.httpOnly, original.httpOnly); assert.equal(copy.sameSite, original.sameSite); assert.equal(copy.domain, original.domain); assert.equal(original.name, 'owned-editor-a');
  check('Copy as new unlocks the identity, refuses an unchanged identity, and creates a second cookie with the same value and flags while the original stays');

  // ---- 7. Keyboard (Chrome: real key events): Tab order Unix field -> forward -> back -> date field; Enter and Space press the arrows.
  await openEditor('owned-editor-a'); assert.deepEqual(await get(() => [...document.querySelectorAll('[data-cookies-converter] input, [data-cookies-converter] button, [data-cookies-converter] select')].map(node => node.getAttribute('data-cookies-field') ?? node.getAttribute('data-cookies-convert') ?? (node.hasAttribute('data-cookies-datetime') ? 'date' : 'zone'))), ['expirationDate', 'forward', 'back', 'date', 'zone'], 'DOM order is the reading and tab order');
  if (isChrome) {
    const page = opened.context.pages().find(candidate => candidate.url().startsWith(opened.base)), active = () => get(() => document.activeElement?.getAttribute('data-cookies-field') ?? document.activeElement?.getAttribute('data-cookies-convert') ?? (document.activeElement?.hasAttribute('data-cookies-datetime') ? 'date' : document.activeElement?.tagName));
    await get(() => document.querySelector('[data-cookies-field="expirationDate"]').focus());
    const walked = []; for (let step = 0; step < 4; step++) { await page.keyboard.press('Tab'); walked.push(await active()); }
    assert.deepEqual(walked, ['forward', 'back', 'date', 'SELECT'], 'Tab walks the arrows in order');
    await get(() => document.querySelector('[data-cookies-field="expirationDate"]').focus()); await page.keyboard.press('Tab'); await opened.fill(sel.date, '2020-01-01 00:00:00Z'); await get(() => document.querySelector('[data-cookies-convert="forward"]').focus());
    await page.keyboard.press('Enter'); await until(async () => (await value(sel.date)) !== '2020-01-01 00:00:00Z', 'Enter presses the forward arrow');
    await opened.fill(sel.date, '2031-05-06 07:08:09.5Z'); await get(() => document.querySelector('[data-cookies-convert="back"]').focus()); await page.keyboard.press('Space');
    await until(async () => (await value(sel.unix)).endsWith('.5') && Math.abs(Number(await value(sel.unix)) - Date.UTC(2031, 4, 6, 7, 8, 9) / 1000 - 0.5) < 1e-6, 'Space presses the back arrow');
    check('keyboard: Tab walks Unix field, forward arrow, back arrow, date field, time zone; Enter and Space operate the arrows');
  } else check('keyboard (Firefox: DOM order only; real key events are exercised in Chrome): the converter controls are in reading order');
  await opened.click(sel.cancel);

  // ---- 8. Daylight-saving gaps and overlaps with the browser's real Date rules (Chrome: CDP time zone override; Firefox: only when TZ is honoured).
  const page = isChrome ? opened.context.pages().find(candidate => candidate.url().startsWith(opened.base)) : null, session2 = isChrome ? await opened.context.newCDPSession(page) : null;
  const zones = [['America/New_York', '2026-03-08 02:30:00', '2026-11-01 01:30:00', '-05:00', '2026-01-15', '-05:00', '2026-07-15', '-04:00'], ['Australia/Sydney', '2026-10-04 02:30:00', '2026-04-05 02:30:00', '+10:00', '2026-01-15', '+11:00', '2026-07-15', '+10:00']];
  for (const [zoneId, gap, overlap, offset, winter, winterOffset, summer, summerOffset] of zones) {
    if (isChrome) await session2.send('Emulation.setTimezoneOverride', { timezoneId: zoneId });
    else if (zoneId !== 'America/New_York') continue;
    const proof = await get(({ gap }) => { const [date, time] = gap.split(' '), [year, month, day] = date.split('-').map(Number), [hour] = time.split(':').map(Number); return new Date(year, month - 1, day, hour, 30).getHours() !== hour; }, { gap });
    if (!proof) { evidence.notes.push('Firefox does not honour TZ on this machine: the DST checks were not run in Firefox'); break; }
    await openEditor('owned-editor-a'); await setSelect(sel.zone, 'local');
    await opened.fill(sel.date, gap); await opened.click(sel.back); assert.equal((await until(converterError, zoneId + ' gap')).code, 'datetime:gap', zoneId + ': ' + gap + ' does not exist');
    await opened.fill(sel.date, overlap); await opened.click(sel.back); assert.equal((await until(() => converterError().then(error => error?.code === 'datetime:ambiguous' ? error : null), zoneId + ' overlap')).code, 'datetime:ambiguous', zoneId + ': ' + overlap + ' occurs twice');
    assert.equal(await value(sel.unix), String(written.expirationDate), 'refused conversions change nothing');
    await opened.fill(sel.date, gap + offset); await opened.click(sel.back); await until(async () => (await value(sel.unix)) !== String(written.expirationDate), zoneId + ' explicit offset in the gap');
    const resolved = Number(await value(sel.unix)), [datePart, timePart] = gap.split(' '), [y, mo, d] = datePart.split('-').map(Number), [h, mi, s] = timePart.split(':').map(Number), sign = offset.startsWith('-') ? -1 : 1, minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
    assert.equal(resolved, (Date.UTC(y, mo - 1, d, h, mi, s) - minutes * 60000) / 1000, zoneId + ': an explicit offset resolves the gap');
    for (const [day, expected] of [[winter, winterOffset], [summer, summerOffset]]) {
      const noon = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12) / 1000;
      await opened.fill(sel.unix, String(noon)); await opened.click(sel.forward); const shown = await until(async () => { const text = await value(sel.date); return text.startsWith(day) ? text : null; }, zoneId + ' ' + day);
      assert.ok(shown.endsWith(expected), zoneId + ': ' + shown + ' carries the offset ' + expected + ' the zone has on ' + day);
      await opened.fill(sel.unix, ''); await opened.click(sel.back); await until(async () => (await value(sel.unix)) === String(noon), zoneId + ' ' + day + ' round trip');
    }
    await opened.click(sel.cancel); evidence.notes.push('DST gap, overlap, explicit offset and summer/winter offsets verified in ' + zoneId);
    check('daylight saving in ' + zoneId + ': ' + gap + ' (gap) and ' + overlap + ' (overlap) are refused, an explicit offset resolves them, summer and winter show their own offsets and round-trip');
  }
  if (isChrome) await session2.send('Emulation.setTimezoneOverride', { timezoneId: '' });

  // ---- 9. Layout, direction and contrast in Russian, English and Arabic, light and dark, wide to narrow.
  await openEditor('owned-editor-a');
  const WIDTHS = isChrome ? [1180, 700, 520, 360] : [1180, 700, 520, 340];
  for (const [id, theme] of [['en', 'light'], ['en', 'dark'], ['ru', 'light'], ['ru', 'dark'], ['ar', 'light'], ['ar', 'dark']]) {
    await language(id, theme); await openEditor('owned-editor-a');
    for (const width of WIDTHS) {
      await opened.viewport(width, 900); await pause(350);
      const view = await measure(), stacked = view.formContent <= 560, rtl = id === 'ar';
      assert.equal(view.pageOverflow, false, id + '/' + theme + '/' + width + ': the page scrolls sideways'); assert.equal(view.dialogOverflow, false, id + '/' + theme + '/' + width + ': the dialog scrolls sideways'); assert.equal(view.unresolved, false, id + ': an unresolved key or placeholder is on screen');
      assert.equal(view.direction, rtl ? 'rtl' : 'ltr'); assert.equal(view.dateClipped, false, id + '/' + width + ': the date text is clipped');
      for (const name of ['unix', 'date', 'forward', 'back', 'zone']) assert.ok(view[name].left >= view.dialog.left - 1 && view[name].right <= view.dialog.right + 1, id + '/' + width + ': ' + name + ' leaves the dialog');
      if (stacked) {
        assert.ok(view.forward.top >= view.unix.bottom - 1 && view.date.top >= view.forward.bottom - 1, id + '/' + width + ': stacked order is Unix field, arrows, date field'); assert.equal(view.forwardTransform, 'matrix(0, 1, -1, 0, 0, 0)', 'forward points down'); assert.equal(view.backTransform, 'matrix(0, -1, 1, 0, 0, 0)', 'back points up');
      } else {
        assert.ok(Math.abs(view.unix.top - view.date.top) <= 2 && Math.abs(view.unix.bottom - view.date.bottom) <= 2, id + '/' + width + ': the two fields share a row'); assert.ok(Math.abs(view.forward.bottom - view.unix.bottom) <= 2 && Math.abs(view.back.bottom - view.date.bottom) <= 2, id + '/' + width + ': the arrows sit on the field line');
        const [first, second] = rtl ? [view.date, view.unix] : [view.unix, view.date]; assert.ok(first.right <= view.forward.left + 1 && view.back.right <= second.left + 1 && view.forward.right <= view.back.left + 1 || rtl, id + '/' + width + ': arrows are between the fields');
        if (rtl) assert.ok(view.date.right <= view.back.left + 1 && view.forward.right <= view.unix.left + 1, 'RTL: the date field is on the left, the Unix field on the right, the arrows between');
        const mirrored = 'matrix(-1, 0, 0, 1, 0, 0)'; assert.equal(view.forwardTransform, rtl ? mirrored : 'none', id + ': forward arrow direction'); assert.equal(view.backTransform, rtl ? 'none' : mirrored, id + ': back arrow direction');
      }
      assert.ok(Math.abs(view.forward.width - 40) <= 1 && Math.abs(view.forward.height - 40) <= 1, 'arrow buttons are 40px squares');
      if (view.dialogScrolls) assert.ok(view.actions.bottom <= view.dialog.bottom + 1 && view.save.bottom <= view.innerHeight, id + '/' + width + ': Save stays reachable in a scrolling dialog');
      evidence.layouts.push({ id, theme, width, stacked, dialogWidth: Math.round(view.dialog.width), formContent: Math.round(view.formContent), dialogScrolls: view.dialogScrolls });
      if (width === WIDTHS[0] || width === WIDTHS[2] || width === WIDTHS.at(-1)) await shot('editor-' + id + '-' + theme + '-' + width);
      if (width === WIDTHS[0] || width === WIDTHS.at(-1)) { await scrollTo('[data-cookies-converter]'); await shot('converter-' + id + '-' + theme + '-' + width); await get(() => { const dialog = document.querySelector('[data-cookies-dialog="editor"]'); dialog.scrollTop = dialog.scrollHeight; }); await pause(100); await shot('details-' + id + '-' + theme + '-' + width); await get(() => { document.querySelector('[data-cookies-dialog="editor"]').scrollTop = 0; }); }
    }
    await opened.viewport(1180, 900); await pause(250);
    const rows = {}; for (const [name, selector] of [['hint', '[data-cookies-details] > p'], ['detailLabel', '.cookies-workspace-detail dt'], ['detailValue', '.cookies-workspace-detail dd'], ['lockNote', '[data-cookies-lock-note] p'], ['label', '[data-cookies-converter] label span']]) rows[name] = await contrast(selector);
    // States with their own text colours: SameSite None without Secure raises a problem; a bad date raises the inline converter error.
    await opened.click('[data-cookies-field="secure"]'); await until(() => get(() => Boolean(document.querySelector('[data-cookies-problem="samesite-none"]'))), 'problem shown');
    rows.problem = await contrast('[data-cookies-problem="samesite-none"]');
    if (id === 'en' && theme === 'light') { await scrollTo('[data-cookies-problems]'); await shot('state-problems-en-light'); }
    await opened.fill(sel.date, 'x'); await opened.click(sel.back); await until(converterError, 'inline error shown'); rows.error = await contrast('[data-cookies-converter-error]');
    for (const [name, ratio] of Object.entries(rows)) assert.ok(ratio >= 4.5, id + '/' + theme + ': ' + name + ' text contrast ' + (ratio ?? 0).toFixed(2) + ' is below 4.5:1');
    evidence.layouts.push({ id, theme, contrast: Object.fromEntries(Object.entries(rows).map(([name, ratio]) => [name, Number(ratio.toFixed(2))])) });
  }
  check('layout, direction and contrast hold in en/ru/ar, light and dark, from 1180 down to 340-360 px: no sideways scroll, no clipped date, arrows between the fields (mirrored in Arabic, vertical when stacked), Save reachable, text contrast >= 4.5:1');

  // ---- 10. All 21 languages in the open dialog: nothing unresolved, nothing overflows at a wide and a narrow width.
  await language('en', 'light'); await openEditor('owned-editor-a');
  for (const item of PRODUCTION_LANGUAGES) {
    await language(item.id, 'light', { reload: false });
    for (const width of [900, WIDTHS.at(-1)]) {
      await opened.viewport(width, 900); await pause(200); const view = await measure();
      assert.equal(view.unresolved, false, item.id + '/' + width + ': unresolved key or placeholder'); assert.equal(view.pageOverflow || view.dialogOverflow, false, item.id + '/' + width + ': sideways scroll'); assert.equal(view.dateClipped, false, item.id + ': date clipped');
    }
    const label = await get(() => document.querySelector('[data-cookies-convert="forward"]').getAttribute('aria-label') + '|' + document.querySelector('[data-cookies-convert="back"]').getAttribute('aria-label')); evidence.arrowLabels = { ...evidence.arrowLabels, [item.id]: label };
    assert.ok(label.split('|').every(text => text.length > 3) && label.split('|')[0] !== label.split('|')[1], item.id + ': arrow names');
  }
  check('all 21 languages render the open editor without an unresolved key or placeholder and without sideways scroll at a wide and a narrow width; both arrows have distinct translated names');
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
  console.log((evidence.result === 'PASS' ? 'PASS ' : 'FAIL ') + browser + ': ' + evidence.checks.length + ' checks, ' + evidence.layouts.length + ' layout rows, ' + evidence.screenshots.length + ' screenshots; evidence in ' + run);
}
