// ADR-103 round 5 (P-UI): how the redesigned Proxy manager looks and behaves in real browsers, with evidence a person can look at.
//   node scripts/test/proxy-ui-visual-native.mjs [--firefox] [--extension <dir> | --from-source] [--shots <dir>] [--only layout,contrast,...]
// Screenshots (light, dark, high contrast, forced colors, Arabic; 1280/820/390 px, all themes) go to
// test-results/production-2.0.0/proxy-ui/; the programmatic checks are layout tiers, no horizontal scroll down to 320 px / 200 % zoom,
// 44 px touch targets on narrow screens, AA contrast of every state chip and glyph in every theme, the keyboard-only flow, reduced
// motion, forced colors, the speed of 100 profiles, 21 languages on a narrow screen and a clean console.
// Not covered, and said so: screen readers (no assistive technology is driven here; only the names, roles and states they read).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { PROXY_WORKSPACE_MESSAGES } from '../production-locales-proxy.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', chrome = browser === 'chrome';
const option = name => { const index = process.argv.indexOf(name); return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null; };
const override = option('--extension') ? resolve(option('--extension')) : null, fromSource = process.argv.includes('--from-source'), privateRun = Boolean(override) || fromSource;
const shots = option('--shots') ? resolve(option('--shots')) : join(root, 'test-results/production-2.0.0/proxy-ui');
const only = option('--only') ? new Set(option('--only').split(',')) : null, wanted = name => !only || only.has(name);
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/proxy-ui-visual-' + browser + '-')), frozen = join(run, 'frozen');
if (override) cpSync(override, frozen, { recursive: true }); else await stageExtension({ browser, target: frozen, from: fromSource ? 'source' : 'dist' });
mkdirSync(shots, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: override ? 'override' : fromSource ? 'source' : 'dist', result: 'RUNNING', disposableProfile: true, externalConnectionAttempted: false, checks: [], screenshots: [], contrast: [], timings: {}, notes: [] };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const THEMES = chrome ? ['system-light', 'system-dark', 'pearl', 'orchid', 'aurora', 'graphite', 'glass'] : ['system-dark', 'pearl', 'orchid', 'aurora', 'graphite', 'glass'];
const DARK_THEMES = new Set(['system-dark', 'aurora', 'graphite', 'glass']);
let opened, phase = 'startup';
const problems = [];

// ---- A controllable check service for Chromium (the real one needs the companion): answers checkProfile with the configured result
// after a delay, grants the optional permissions the UI asks for, and can delay or fail the first load. Nothing leaves the browser.
const FAKE_SERVICE = String.raw`(() => {
  const api = globalThis.chrome; if (!api?.runtime?.connect || globalThis.__puiFake) return; globalThis.__puiFake = true;
  const real = api.runtime.connect.bind(api.runtime);
  api.runtime.connect = (...args) => {
    const port = real(...args);
    if (args[0]?.name !== 'detect.expert.proxy/v1') return port;
    let last = null; const listeners = [], add =port.onMessage.addListener.bind(port.onMessage), post = port.postMessage.bind(port), ops = new Map(), mode = () => { try { return JSON.parse(localStorage.getItem('__puiLoad') || 'null'); } catch { return null; } };
    port.onMessage.addListener = fn => { listeners.push(fn); add(message => { if (message?.snapshot?.configuration && (message.ok === true || message.type === 'change')) last = message.snapshot; const load = mode(); if (message?.type === 'change' && (load?.fail || load?.delay)) return; if (ops.get(message?.id) === 'load' && load?.delay) setTimeout(() => fn(message), load.delay); else fn(message); }); };
    port.postMessage = message => {
      ops.set(message?.id, message?.op);
      // The companion check: with the flag set, the service answers that a companion is there (the last snapshot, plus the host). Nothing real is asked.
      if (message?.op === 'hostStatus' && localStorage.getItem('__puiHost') && last) {
        const snapshot = { ...last, host: { available: true, version: 1, capabilities: { socks5: true, http: true, https: true, vless: true, openvpn: true, vault: true } } };
        setTimeout(() => { for (const fn of listeners) fn({ v: 1, id: message.id, ok: true, snapshot }); }, 60);
        return;
      }
      const load = mode();
      if (message?.op === 'load' && load?.fail) { setTimeout(() => { for (const fn of listeners) fn({ v: 1, id: message.id, ok: false, error: { code: 'timeout', phase: 'tunnel', retryable: true } }); }, 40); return; }
      if (message?.op === 'checkProfile') {
        const cfg = globalThis.__puiChecks || {}, id = message.payload.id, entry = cfg[id] ?? cfg.default ?? { state: 'pass', ms: 140, ip: '203.0.113.9' };
        setTimeout(() => {
          const diagnostic = entry.state === 'pass' ? { state: 'pass', reachable: true, remoteDns: entry.dns !== false, tlsVerified: entry.tls !== false, httpStatus: entry.status ?? 200, ip: entry.ip ?? null, elapsedMs: entry.ms ?? 140 } : { state: 'fail', code: entry.code ?? 'auth-failed', phase: entry.phase ?? 'auth' };
          for (const fn of listeners) fn({ v: 1, id: message.id, ok: true, result: { profileId: id, diagnostic } });
        }, entry.delay ?? 450);
        return;
      }
      post(message);
    };
    return port;
  };
  if (api.permissions) { api.permissions.request = async () => true; const contains = api.permissions.contains?.bind(api.permissions); api.permissions.contains = async query => (query?.permissions ?? []).includes('nativeMessaging') || (query?.permissions ?? []).includes('clipboardWrite') ? true : contains ? contains(query) : true; }
})();`;

// ---- A realistic roster: five kinds, tags, no tag, names with accents and long names, history with slow, failed and moved exit IPs
const KINDS = ['socks5', 'http', 'https', 'vless', 'openvpn'], COUNTRIES = ['DE', 'US', 'NL', 'JP', 'GB', 'FR', 'PL', 'SG', 'CA', 'SE', 'BR', 'IN'];
const NAMES = ['Frankfurt office', 'US residential pool with a deliberately long name', 'Amsterdam fast', 'Tokyo night', 'London test', 'Paris backup', 'Warsaw 1', 'Singapore edge', 'Toronto pool', 'Stockholm', 'São Paulo', 'Mumbai', 'Berlin VLESS', 'Tokyo OpenVPN', 'Oslo SOCKS', 'Dublin HTTPS', 'Prague', 'Vienna', 'Zurich', 'Helsinki'];
function profilesOf(count, directOnly = false) {
  return Array.from({ length: count }, (_, i) => {
    const type = directOnly ? ['socks5', 'http', 'https'][i % 3] : KINDS[i % KINDS.length], native = !directOnly && (type === 'vless' || type === 'openvpn' || i % 7 === 3), hidden = native && ['socks5', 'vless', 'openvpn'].includes(type) && i % 3 === 0;
    return { id: 'p-' + String(i + 1).padStart(3, '0'), name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (Math.floor(i / NAMES.length) + 1) : ''), type, host: hidden ? null : '203.0.113.' + (10 + i % 200), port: hidden ? null : type === 'https' ? 443 : type === 'http' ? 8080 : 1080 + i, native, ...(i % 4 !== 3 ? { country: COUNTRIES[i % COUNTRIES.length] } : {}) };
  });
}
const configurationOf = (profiles, patch = {}) => ({ format: 'detect.expert.proxy', version: 1, revision: 5, enabled: false, selectedId: profiles[0]?.id ?? null, profiles, routing: { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: true }, protectWebRTC: true, disablePrediction: true, killSwitch: true, autoConnect: false, ...patch });
function historyOf(profiles, now) {
  const items = {}, ago = minutes => now - minutes * 60000;
  profiles.slice(0, 8).forEach((profile, i) => {
    const entries = [];
    for (let k = 9; k >= 0; k--) {
      const at = ago(k * 55 + i * 7 + 2);
      if ((i === 2 && k === 4) || (i === 5 && k % 3 === 1)) { entries.push({ firstAt: at, lastAt: at, checks: 1, ok: false, code: i === 2 ? 'connection-refused' : 'auth-failed', ms: 0, dns: 'unknown', tls: 'unknown', status: 0, ip: '' }); continue; }
      const ip = '198.51.100.' + (10 + i + (k > 6 ? 1 : 0)), last = entries.at(-1);
      if (last && last.ok && last.ip === ip) { last.firstAt = Math.min(last.firstAt, at); last.checks += 1; last.ms = 90 + ((k * 37 + i * 53) % 420); continue; }
      entries.push({ firstAt: at, lastAt: at, checks: 1, ok: true, code: '', ms: 90 + ((k * 61 + i * 29) % 1300), dns: 'ok', tls: i % 3 === 0 ? 'unknown' : 'ok', status: 200, ip });
    }
    items[profile.id] = entries.sort((a, b) => a.lastAt - b.lastAt);
  });
  return { version: 1, enabled: true, items };
}
const linksOf = profiles => ({ version: 1, links: { ['fp-' + 'a'.repeat(32)]: profiles[0].id, ['fp-' + 'b'.repeat(32)]: profiles[0].id, ['fp-' + 'c'.repeat(32)]: profiles[2].id } });

// ---- Page helpers (all page code is self-contained functions: the Firefox driver sends them as source)
const setStorage = data => opened.evaluate(async data => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set(data); return true; }, data);
const removeStorage = keys => opened.evaluate(async keys => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.remove(keys); return true; }, keys);
const proxyPage = () => opened.context.pages().find(page => page.url().startsWith(opened.base + 'options.html'));
let reloads = 0;
const probe = async fn => { try { return await fn(); } catch { return false; } };
const navigate = async (query) => { await opened.goto(opened.base + 'options.html' + query + '#proxy'); await until(() => probe(() => opened.evaluate(query => location.search === query && document.readyState === 'complete', query)), 'navigation to ' + query, 40000); };
const ready = (count = null) => until(() => probe(() => opened.evaluate(count => document.querySelector('[data-proxy-workspace]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-proxy-new]')?.disabled === false && (count === null || document.querySelectorAll('[data-proxy-profile]').length === count), count)), 'Proxy ready');
// The Proxy service keeps the configuration in memory and ignores storage written behind its back, so a seed is applied the way the
// browser allows: in Chromium the worker is stopped (CDP) after the storage write and starts again from the seed; in Firefox the
// profiles are imported through the page's own import dialog (direct SOCKS5, HTTP and HTTPS profiles: the others need the companion).
let ids = [];
const rowCount = () => opened.evaluate(() => document.querySelectorAll('[data-proxy-profile]').length);
async function restartWorker() {
  const cdp = await opened.context.newCDPSession(proxyPage());
  try { await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await pause(500); } finally { await cdp.detach().catch(() => {}); }
}
async function seed({ count = 14, history = true, links = true, patch = {}, load = null } = {}) {
  await harvest();
  let profiles = profilesOf(count, !chrome);
  if (chrome) {
    await setStorage({ 'proxy-configuration:v1': configurationOf(profiles, patch) });
  } else {
    // Firefox: through the page itself, with what a person has: delete everything, then paste the list into the import dialog.
    await opened.viewport(1280, 900); await navigate('?r=' + (++reloads)); await ready();
    if (await rowCount()) { await opened.click('[data-proxy-select-all]'); await opened.click('[data-proxy-delete-selected]'); await opened.click('[data-proxy-remove-confirm]'); await until(async () => (await rowCount()) === 0, 'profiles removed', 90000); await ready(); }
    if (count) {
      await opened.click('[data-proxy-menu="add"]'); await opened.click('[data-proxy-bulk-open]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-bulk]')?.open)), 'import dialog');
      await opened.fill('[data-proxy-bulk-text]', profiles.map(profile => profile.type + '://' + profile.host + ':' + profile.port + ' #' + profile.name).join(String.fromCharCode(10))); await opened.click('[data-proxy-bulk-parse]');
      await until(() => opened.evaluate(() => document.querySelector('dialog[data-proxy-bulk]')?.dataset.proxyBulk === 'preview'), 'import preview');
      await opened.click('[data-proxy-bulk-save]'); await until(() => opened.evaluate(() => !document.querySelector('dialog[data-proxy-bulk]')), 'import saved', 180000);
      await ready(count); if (await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-imported-close]')))) await opened.click('[data-proxy-imported-close]');
    }
    const idByName = await opened.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-proxy-profile]')].map(row => [row.querySelector('.pm-name-main').textContent.trim(), row.getAttribute('data-proxy-profile')])));
    profiles = profiles.map(profile => ({ ...profile, id: idByName[profile.name] }));
    assert.ok(profiles.every(profile => profile.id), 'every seeded profile is listed');
  }
  ids = profiles.map(profile => profile.id);
  if (history && count) await setStorage({ 'proxy-check-history:v1': historyOf(profiles, Date.now()) }); else await removeStorage(['proxy-check-history:v1']);
  if (links && count) await setStorage({ 'identity-bundles:v1': linksOf(profiles) }); else await removeStorage(['identity-bundles:v1']);
  if (chrome) await opened.evaluate(load => { if (load) localStorage.setItem('__puiLoad', JSON.stringify(load)); else localStorage.removeItem('__puiLoad'); return true; }, load);
  if (chrome) await restartWorker();
  await navigate('?r=' + (++reloads));
  return profiles;
}
const themeOf = (theme, scheme) => theme === 'system' && !chrome ? (scheme === 'dark' ? 'system' : 'pearl') : theme;
async function arrange({ width = 1280, height = 900, scheme = 'light', theme = 'system', language = 'en', forced = 'none', contrast = 'no-preference', reduced = 'no-preference' } = {}) {
  const id = themeOf(theme, scheme);
  await setStorage({ 'ui-theme-v1': id, 'ui-language-v1': language });
  if (chrome) await opened.media({ colorScheme: scheme, forcedColors: forced, contrast, reducedMotion: reduced });
  await opened.viewport(width, height);
  const label = PROXY_WORKSPACE_MESSAGES[language].proxy_workspace_selected_domains;
  await until(() => opened.evaluate(({ id, label }) => document.documentElement.getAttribute('data-ui-theme') === id && document.documentElement.getAttribute('data-ui-theme-ready') === 'true' && document.querySelector('[data-proxy-route-mode="include"]')?.closest('label')?.textContent.trim() === label, { id, label }), 'theme ' + id + ' and language ' + language);
  await pause(300);
}
const shotNames = new Set();
async function shot(name, { keepFocus = false, viewport = false, from = null } = {}) {
  const file = browser + '-' + name + '.png', path = join(shots, file);
  assert.ok(!shotNames.has(file), 'duplicate screenshot name ' + file); shotNames.add(file);
  await opened.evaluate(async ({ keepFocus, from }) => { if (!keepFocus) document.activeElement?.blur?.(); const target = from ? document.querySelector(from) : null; window.scrollTo(0, target ? Math.max(0, target.getBoundingClientRect().top + scrollY - 64) : 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; }, { keepFocus, from });
  await pause(380);
  if (viewport && chrome) await proxyPage().screenshot({ path }); else await opened.screenshot(path);
  evidence.screenshots.push({ file, sha256: hash(readFileSync(path)) });
}
// Back to the plain list: details, sheets, menus, selection and filters closed or cleared.
async function reset() {
  await opened.evaluate(() => {
    for (const selector of ['[data-proxy-cancel]', '[data-proxy-bulk-cancel]', '[data-proxy-peek-close]', '[data-proxy-clear-selection]', '[data-proxy-summary-close]', '[data-proxy-filters-clear]', '[data-proxy-remove-cancel]', '[data-proxy-discard-settings]']) document.querySelector(selector)?.click();
    if (document.querySelector('[data-proxy-filters-toggle][aria-expanded="true"]') && getComputedStyle(document.querySelector('[data-proxy-filters-toggle]')).display !== 'none') document.querySelector('[data-proxy-filters-toggle]').click();
    document.querySelector('[data-proxy-panel][aria-expanded="true"]')?.click();
    if (document.querySelector('[data-proxy-help][aria-expanded="true"]')) document.querySelector('[data-proxy-help]').click();
    const menu = document.querySelector('[data-menu-open] [data-proxy-menu]'); if (menu) menu.click();
    return true;
  });
  await pause(220);
}
const harvest = async () => { try { problems.push(...await opened.evaluate(() => { const list = globalThis.__puiErrors ?? []; globalThis.__puiErrors = []; return list; })); } catch { /* the page is navigating */ } };
const hook = (name, value = null) => '[' + name + (value === null ? '' : '="' + value + '"') + ']';

// ---- Contrast probe: runs in the page. Colors are read from the computed style and composited over the real backdrop; text is
// judged against 4.5:1 (3:1 for large text), state glyphs against 3:1. Disabled controls and visually hidden text are exempt, as in WCAG.
function contrastProbe(options) {
  const scope = options.scope ? document.querySelector(options.scope) : document.querySelector('[data-proxy-workspace]');
  const clamp = value => Math.max(0, Math.min(255, value));
  const number = (token, percentScale = 1) => token.endsWith('%') ? parseFloat(token) / 100 * percentScale : parseFloat(token);
  const oklab = (lightness, a, b) => {
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    return linear.map(c => clamp(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055)));
  };
  const toRgb = value => {
    const text = String(value ?? '').trim();
    if (!text || text === 'transparent') return [0, 0, 0, 0];
    let match = /^rgba?\(([^)]+)\)$/.exec(text);
    if (match) { const parts = match[1].split(/[\s,/]+/).filter(Boolean); return [clamp(number(parts[0], 255)), clamp(number(parts[1], 255)), clamp(number(parts[2], 255)), parts[3] === undefined ? 1 : number(parts[3])]; }
    match = /^color\(\s*(srgb|srgb-linear|display-p3)\s+([^)]+)\)$/.exec(text);
    if (match) { const parts = match[2].split(/[\s/]+/).filter(Boolean), rgb = parts.slice(0, 3).map(token => number(token)); const linear = match[1] === 'srgb-linear'; return [...rgb.map(c => clamp(255 * (linear ? (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) : c))), parts[3] === undefined ? 1 : number(parts[3])]; }
    match = /^oklab\(([^)]+)\)$/.exec(text);
    if (match) { const parts = match[1].split(/[\s/]+/).filter(Boolean); return [...oklab(number(parts[0]), number(parts[1], 0.4), number(parts[2], 0.4)), parts[3] === undefined ? 1 : number(parts[3])]; }
    match = /^oklch\(([^)]+)\)$/.exec(text);
    if (match) { const parts = match[1].split(/[\s/]+/).filter(Boolean), hue = parseFloat(parts[2]) * Math.PI / 180, chroma = number(parts[1], 0.4); return [...oklab(number(parts[0]), chroma * Math.cos(hue), chroma * Math.sin(hue)), parts[3] === undefined ? 1 : number(parts[3])]; }
    return null;
  };
  const linear = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = color => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
  const ratioOf = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, bottom) => { const alpha = top[3] + bottom[3] * (1 - top[3]); return alpha === 0 ? [0, 0, 0, 0] : [0, 1, 2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha); };
  const canvas = (() => { const probe = document.createElement('div'); probe.style.backgroundColor = 'Canvas'; document.body.append(probe); const color = toRgb(getComputedStyle(probe).backgroundColor); probe.remove(); return color ?? [255, 255, 255, 1]; })();
  const backdropOf = element => {
    const layers = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const color = toRgb(getComputedStyle(node).backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] >= 1) break;
    }
    let base = layers.length && layers.at(-1)[3] >= 1 ? layers.pop() : canvas;
    while (layers.length) base = over(layers.pop(), base);
    return base;
  };
  const opacityOf = element => { let value = 1; for (let node = element; node && node.nodeType === 1; node = node.parentElement) value *= parseFloat(getComputedStyle(node).opacity); return value; };
  const describe = element => { const data = [...element.attributes].filter(attribute => attribute.name.startsWith('data-')).slice(0, 2).map(attribute => '[' + attribute.name + ']').join(''); return element.tagName.toLowerCase() + (element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).slice(0, 4).join('.') : '') + data; };
  const visible = element => { const style = getComputedStyle(element); if (style.display === 'none' || style.visibility === 'hidden') return false; const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1; };
  const exempt = element => element.disabled === true || element.closest('[disabled],[aria-disabled="true"],fieldset:disabled,.proxy-workspace-sr,[inert]') !== null || ['SCRIPT', 'STYLE', 'OPTION'].includes(element.tagName);
  const failures = [], glyphFailures = [], seen = { text: 0, glyph: 0 };
  const round = value => Math.round(value * 100) / 100, rgbText = color => color.slice(0, 3).map(Math.round).join(',') + (color[3] < 1 ? '/' + round(color[3]) : '');
  for (const element of [scope, ...scope.querySelectorAll('*')]) {
    if (exempt(element) || !visible(element)) continue;
    if (element instanceof SVGElement && element.tagName.toLowerCase() === 'svg') {
      if (element.getBoundingClientRect().width > 48 || element.classList.contains('pm-skel')) continue;
      const style = getComputedStyle(element), backdrop = backdropOf(element), opacity = opacityOf(element);
      if (opacity < 0.05) continue;
      let color = toRgb(style.color); if (!color) continue;
      color = over([color[0], color[1], color[2], color[3] * opacity], backdrop);
      const ratio = ratioOf(color, backdrop); seen.glyph++;
      if (ratio < 3) glyphFailures.push({ element: describe(element.parentElement) + ' > svg', ratio: round(ratio), fg: rgbText(color), bg: rgbText(backdrop) });
      continue;
    }
    if (element instanceof SVGElement) continue;
    const own = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (!own) continue;
    const style = getComputedStyle(element), backdrop = backdropOf(element), opacity = opacityOf(element);
    if (opacity < 0.05) continue;
    let color = toRgb(style.color); if (!color) continue;
    color = over([color[0], color[1], color[2], color[3] * opacity], backdrop);
    const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10) || 400, large = size >= 24 || (size >= 18.66 && weight >= 700), ratio = ratioOf(color, backdrop), needed = large ? 3 : 4.5;
    seen.text++;
    if (ratio < needed) failures.push({ element: describe(element), text: element.textContent.trim().slice(0, 28), ratio: round(ratio), needed, size, fg: rgbText(color), bg: rgbText(backdrop) });
  }
  return { seen, failures, glyphFailures };
}

// A gallery of every state a chip, message or note can have, built from real nodes so that the real stylesheet decides the colors.
function injectGallery() {
  const workspace = document.querySelector('[data-proxy-workspace]'); document.querySelector('[data-probe-gallery]')?.remove();
  const badge = document.querySelector('.pm-badge-icon'), host = document.createElement('div'); host.setAttribute('data-probe-gallery', ''); host.className = 'pm-probe-gallery';
  const make = (classes, label, glyph = 'pass', tag = 'span') => { const element = document.createElement(tag); element.className = classes; if (badge) { const icon = badge.cloneNode(true); icon.setAttribute('data-glyph', glyph); element.append(icon); } const text = document.createElement('span'); text.textContent = label; element.append(text); host.append(element); return element; };
  for (const [state, glyph] of [['off', 'unknown'], ['connecting', 'pending'], ['connected', 'pass'], ['blocked', 'fail'], ['error', 'fail'], ['conflict', 'warning'], ['permission-required', 'warning']]) { make('pm-state pm-state--' + state, state, glyph); make('pm-route-tag pm-route-tag--' + state, state, glyph); }
  for (const [classes, label, glyph] of [['pm-pill pm-check pm-check--pass pm-latency--fast', 'Fast 120 ms', 'pass'], ['pm-pill pm-check pm-check--pass pm-latency--ok', 'Medium 640 ms', 'pass'], ['pm-pill pm-check pm-check--pass pm-latency--slow', 'Slow 2100 ms', 'pass'], ['pm-pill pm-check pm-check--fail', 'Failed', 'fail'], ['pm-pill pm-check pm-check--checking', 'Checking', 'pending'], ['pm-pill pm-check pm-check--unknown', 'Not checked', 'unknown'], ['pm-pill pm-pill--info', 'Remote DNS', 'pass'], ['pm-pill pm-changed', 'Exit IP changed', 'pending'], ['pm-micro pm-flag pm-flag--fail', 'TLS', 'fail'], ['pm-micro pm-flag pm-flag--unknown', 'DNS', 'unknown'], ['pm-micro', 'DNS', 'pass'], ['pm-failed', 'Failed', 'fail']]) make(classes, label, glyph);
  for (const type of ['socks5', 'http', 'https', 'vless', 'openvpn']) make('pm-pill pm-typepill pm-type--' + type, type.toUpperCase(), 'pass');
  for (const kind of ['info', 'ok', 'error']) make('pm-message pm-message--' + kind, 'A ' + kind + ' message with words', kind === 'ok' ? 'pass' : kind === 'error' ? 'fail' : 'unknown', 'p');
  for (const kind of ['warn', 'info']) make('pm-note pm-note--' + kind, 'A ' + kind + ' note with words', 'warning', 'p');
  for (const kind of ['ok', 'warn', 'info', 'err']) make('pm-stat pm-stat--' + kind, 'Stat ' + kind, 'pass');
  for (const kind of ['ok', 'invalid']) make('pm-preview pm-preview--' + kind, 'Preview ' + kind, 'pass', 'p');
  workspace.append(host); return host.children.length;
}
function removeGallery() { document.querySelector('[data-probe-gallery]')?.remove(); return true; }

// ---- Scenes ------------------------------------------------------------------------------------------------------------------------
const FIREFOX_SHOTS = new Set(['list-light-1280', 'list-dark-1280', 'list-ar-1280', 'list-light-390', 'peek-dark-820', 'sheet-light-1280', 'theme-graphite-1280']);
const guard = () => opened.evaluate(() => { globalThis.__puiErrors ??= []; if (!globalThis.__puiGuard) { globalThis.__puiGuard = true; addEventListener('error', event => __puiErrors.push('error ' + String(event.message).slice(0, 300))); addEventListener('unhandledrejection', event => __puiErrors.push('rejection ' + String(event.reason?.message ?? event.reason).slice(0, 300))); } return true; });
const openPeek = id => async () => { await opened.click(hook('data-proxy-open', id)); await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-peek="' + id + '"]')), id), 'details of ' + id); await pause(350); };
const openSheet = async () => { await opened.click('[data-proxy-new]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-editor]')?.open)), 'Add sheet'); await pause(350); };
async function scene(name, arrangement, action = async () => {}, { chromeOnly = false, viewport = false, from = null } = {}) {
  if (!wanted('screens') || chromeOnly && !chrome || !chrome && !FIREFOX_SHOTS.has(name)) return;
  await reset(); await arrange(arrangement); await action(); await shot(name, { viewport, from }); await harvest();
}
async function screens() {
  if (!wanted('screens')) return;
  phase = 'screenshots';
  const profiles = await seed({ count: 14 }); await guard(); await ready(14);
  const first = ids[0];
  await scene('list-light-1280', {});
  await scene('list-dark-1280', { scheme: 'dark' });
  await scene('list-hc-1280', { contrast: 'more' }, async () => {}, { chromeOnly: true });
  await scene('list-forced-1280', { forced: 'active' }, async () => {}, { chromeOnly: true });
  await scene('list-ar-1280', { language: 'ar' });
  await scene('list-ar-dark-390', { language: 'ar', width: 390, scheme: 'dark' }, async () => {}, { chromeOnly: true });
  await scene('filters-open-390', { width: 390 }, async () => { await opened.click('[data-proxy-filters-toggle]'); await pause(350); }, { chromeOnly: true });
  await scene('list-light-820', { width: 820, height: 1000 });
  await scene('list-dark-820', { width: 820, height: 1000, scheme: 'dark' });
  await scene('list-light-390', { width: 390 });
  await scene('list-dark-390', { width: 390, scheme: 'dark' });
  await scene('peek-light-1280', {}, openPeek(first), { viewport: true, from: '.pm-listhead' });
  await scene('peek-dark-820', { width: 820, height: 1000, scheme: 'dark' }, openPeek(first), { viewport: true });
  await scene('peek-light-390', { width: 390 }, openPeek(first), { viewport: true });
  await scene('peek-hc-1280', { contrast: 'more' }, openPeek(first), { chromeOnly: true, viewport: true, from: '.pm-listhead' });
  await scene('peek-ar-1280', { language: 'ar' }, openPeek(first), { chromeOnly: true, viewport: true, from: '.pm-listhead' });
  await scene('selection-1280', {}, async () => { for (const id of [ids[1], ids[2], ids[4]]) await opened.click(hook('data-proxy-select', id)); await pause(250); }, { chromeOnly: true, viewport: true });
  await scene('menu-1280', {}, async () => { await opened.click(hook('data-proxy-more', ids[3])); await pause(250); }, { chromeOnly: true });
  await scene('add-menu-1280', {}, async () => { await opened.click(hook('data-proxy-menu', 'add')); await pause(250); }, { chromeOnly: true });
  await scene('columns-menu-1280', {}, async () => { await opened.click(hook('data-proxy-menu', 'columns')); await pause(250); }, { chromeOnly: true });
  await scene('filters-1280', {}, async () => { await opened.click(hook('data-proxy-filter-type', 'socks5')); await opened.click(hook('data-proxy-status-chip', 'pass')); await pause(250); }, { chromeOnly: true });
  await scene('sheet-light-1280', {}, openSheet, { viewport: true });
  await scene('sheet-dark-1280', { scheme: 'dark' }, openSheet, { chromeOnly: true, viewport: true });
  await scene('sheet-errors-390', { width: 390 }, async () => { await openSheet(); await opened.click('[data-proxy-save-profile]'); await pause(350); }, { chromeOnly: true, viewport: true });
  await scene('edit-1280', {}, async () => { await opened.click(hook('data-proxy-more', first)); await opened.click(hook('data-proxy-edit', first)); await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="name"]')?.value?.length > 0), 'edit sheet'); await pause(350); }, { chromeOnly: true, viewport: true });
  await scene('bulk-preview-820', { width: 820, height: 1000 }, async () => {
    await opened.click(hook('data-proxy-menu', 'add')); await opened.click('[data-proxy-bulk-open]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-bulk]')?.open)), 'bulk dialog');
    await opened.fill('[data-proxy-bulk-text]', ['203.0.113.50:1080 #One', '203.0.113.51:1080:user:pass #Two', 'ftp://203.0.113.9:21', '203.0.113.50:1080 #One again', 'https://203.0.113.52:8443 #Secure'].join(String.fromCharCode(10))); await opened.click('[data-proxy-bulk-parse]');
    await until(() => opened.evaluate(() => document.querySelector('dialog[data-proxy-bulk]')?.dataset.proxyBulk === 'preview'), 'bulk preview'); await pause(350);
  }, { chromeOnly: true, viewport: true });
  await scene('routing-1280', {}, async () => { await opened.click(hook('data-proxy-panel', 'routing')); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-panel-body="routing"]'))), 'routing'); await opened.fill('[data-proxy-domain-input="proxyDomains"]', 'example.com, *.corp.example, not a host'); await opened.evaluate(() => { document.querySelector('[data-proxy-domain-input="proxyDomains"]').blur(); return true; }); await pause(300); }, { chromeOnly: true });
  await scene('analyzer-1280', {}, async () => { await opened.click(hook('data-proxy-panel', 'analyzer')); await pause(300); }, { chromeOnly: true });
  await scene('companion-1280', {}, async () => { await opened.click(hook('data-proxy-panel', 'companion')); await pause(300); }, { chromeOnly: true });
  await scene('help-1280', {}, async () => { await opened.click('[data-proxy-help]'); await pause(300); }, { chromeOnly: true });
  for (const theme of ['pearl', 'orchid', 'aurora', 'graphite', 'glass']) await scene('theme-' + theme + '-1280', { theme, scheme: DARK_THEMES.has(theme) ? 'dark' : 'light' });
  if (chrome && wanted('screens')) {
    await scene('checking-1280', {}, async () => { await opened.evaluate(() => { globalThis.__puiChecks = { default: { state: 'pass', ms: 210, ip: '203.0.113.9', delay: 1500 } }; return true; }); await opened.click('[data-proxy-check-visible]'); await pause(2400); }, { viewport: true });
    await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-check-progress]')), 'bulk check finished', 60000);
    await shot('summary-1280', { viewport: true }); await harvest();
  }
  if (chrome && wanted('screens')) {
    await reset(); await seed({ count: 0 }); await guard(); await arrange({}); await ready(0); await shot('empty-1280'); await arrange({ width: 390, scheme: 'dark' }); await shot('empty-dark-390');
    await seed({ count: 14, load: { fail: true } }); await arrange({}); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-load-failed]'))), 'load error'); await shot('error-1280');
    await seed({ count: 14, load: { delay: 2500 } }); await arrange({}); await pause(900); await shot('skeleton-1280');
    await seed({ count: 14 }); await arrange({}); await ready(14);
  }
  check('screenshots of the list, details panel, sheets, menus, panels, empty, error and loading states in light, dark, high contrast, forced colors, Arabic and every theme are in ' + shots.replace(root, '.'));
}

// ---- Programmatic suites -------------------------------------------------------------------------------------------------------------
const overflowOf = () => opened.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth, workspace: Math.round(document.querySelector('[data-proxy-workspace]').getBoundingClientRect().right) }));
function measureLayout() {
  const rect = element => { const box = element.getBoundingClientRect(); return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) }; };
  const list = document.querySelector('[data-proxy-table]'), peek = document.querySelector('[data-proxy-peek]'), row = document.querySelector('[data-proxy-profile]');
  const name = rect(row.querySelector('[data-proxy-open]')), metaElement = [...row.querySelectorAll('.pm-meta > .pm-cell')].find(element => element.getClientRects().length), meta = metaElement ? rect(metaElement) : null, rtl = getComputedStyle(row).direction === 'rtl';
  return { width: innerWidth, rtl, list: rect(list), row: rect(row), peek: peek ? { ...rect(peek), position: getComputedStyle(peek).position } : null, overflow: document.documentElement.scrollWidth - innerWidth,
    filtersToggle: getComputedStyle(document.querySelector('[data-proxy-filters-toggle]')).display !== 'none', filtersBody: getComputedStyle(document.querySelector('.pm-filters')).display !== 'none',
    stacked: meta ? meta.top >= name.bottom - 2 : false, header: getComputedStyle(document.querySelector('[data-proxy-table] .pm-row--head')).display !== 'none' };
}
async function layout() {
  if (!wanted('layout')) return;
  phase = 'layout tiers';
  await seed({ count: 14 }); await guard(); await ready(14);
  const results = [];
  for (const [width, tier] of [[1280, 'two panes'], [1100, 'two panes'], [1099, 'overlay'], [820, 'overlay'], [701, 'overlay'], [699, 'cards'], [390, 'cards'], [chrome ? 320 : 340, 'cards']]) {
    for (const language of ['en', 'ar']) {
      await reset(); await arrange({ width, language, scheme: 'light' });
      const plain = await opened.evaluate(measureLayout);
      assert.ok(plain.overflow <= 0, tier + ' ' + width + ' ' + language + ': no horizontal scroll (' + plain.overflow + ')');
      assert.equal(plain.filtersToggle, tier === 'cards', width + ': the filters button is for phones only'); assert.equal(plain.filtersBody, tier !== 'cards', width + ': the filter chips are folded away on a phone');
      if (tier === 'cards') { await opened.click('[data-proxy-filters-toggle]'); assert.equal(await opened.evaluate(() => getComputedStyle(document.querySelector('.pm-filters')).display !== 'none' && document.querySelector('[data-proxy-filters-toggle]').getAttribute('aria-expanded') === 'true'), true, width + ': the button opens the chips'); await opened.click('[data-proxy-filters-toggle]'); }
      if (tier === 'cards') { assert.equal(plain.stacked, true, width + ' ' + language + ': the row is a stacked card (the details line sits under the name)'); assert.equal(plain.header, false, width + ': cards have no column header row'); }
      else assert.equal(plain.header, true, width + ' ' + language + ': a table-like list keeps its column header row');
      await opened.click(hook('data-proxy-open', ids[0])); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-peek]'))), 'details at ' + width); await pause(350);
      const m = await opened.evaluate(measureLayout); results.push({ width, language, tier, listWidth: m.list.width, peek: m.peek.position });
      assert.ok(m.overflow <= 0, tier + ' ' + width + ' ' + language + ' with details: no horizontal scroll (' + m.overflow + ')');
      if (tier === 'two panes') {
        assert.notEqual(m.peek.position, 'fixed', width + ': the details panel pushes the list');
        assert.ok(m.rtl ? m.peek.right <= m.list.left + 2 : m.peek.left >= m.list.right - 2, width + ' ' + language + ': the panel sits beside the list ' + JSON.stringify({ peek: m.peek, list: m.list }));
      } else {
        assert.equal(m.peek.position, 'fixed', width + ': the details panel overlays the list');
        assert.ok(m.peek.left >= -1 && m.peek.right <= m.width + 1, width + ': the panel stays in the window');
      }
      assert.ok(m.list.right <= m.width + 1 && m.list.left >= -1, width + ' ' + language + ': the list fits the window');
    }
  }
  evidence.layoutTiers = results;
  check('layout tiers: two panes from 1100 px (the details panel pushes the list, mirrored in Arabic), an overlay sheet from 701 to 1099 px, stacked cards below 700 px, nothing outside the window and no horizontal scroll');
}
async function overflow() {
  if (!wanted('overflow')) return;
  phase = 'no horizontal scroll';
  await seed({ count: 14 }); await guard(); await ready(14);
  const widths = chrome ? [320, 360, 390, 480, 640, 700, 820, 1100, 1280] : [340, 390, 640, 820, 1100, 1280];
  for (const language of ['en', 'ar', 'de']) for (const width of widths) {
    await reset(); await arrange({ width, language, scheme: 'dark' });
    const states = [['list', async () => {}], ['details', async () => { await opened.click(hook('data-proxy-open', ids[0])); await pause(300); }], ['sheet', openSheet], ['selection', async () => { await opened.click(hook('data-proxy-select', ids[1])); await pause(200); }]];
    for (const [state, action] of states) {
      await reset(); await action(); const m = await overflowOf();
      assert.ok(m.overflow <= 0, language + ' ' + width + ' ' + state + ': scrollWidth exceeds the window by ' + m.overflow);
    }
  }
  // 200 % zoom of a 1280 px window is a 640 px window; 400 % is 320 px: both are widths above.
  check('no horizontal page scroll at ' + widths.join('/') + ' px (320 px is 400 % zoom, 640 px is 200 % zoom of a 1280 px window) in English, Arabic and German, with the list, the details panel, the Add sheet and the selection bar');
}
async function targets() {
  if (!wanted('touch')) return;
  phase = 'touch targets';
  await seed({ count: 14 }); await guard(); await ready(14);
  for (const width of [390, 699]) {
    await reset(); await arrange({ width, scheme: 'light' });
    const small = await opened.evaluate(() => {
      const found = [];
      for (const element of document.querySelectorAll('[data-proxy-workspace] button, [data-proxy-workspace] input[type="checkbox"], [data-proxy-workspace] select, [data-proxy-workspace] summary, [data-proxy-workspace] [role="radio"]')) {
        if (element.disabled || element.closest('.proxy-workspace-sr,[hidden]') || element.getClientRects().length === 0 || element.matches('[data-proxy-skip]:not(:focus)')) continue;
        const style = getComputedStyle(element); if (style.visibility === 'hidden' || style.display === 'none') continue;
        // The hit area of a checkbox is its label or cell; a button is its own box.
        const box = (element.matches('input[type="checkbox"]') ? element.closest('.pm-cell, label') ?? element : element).getBoundingClientRect();
        // 44 px for buttons, menus and toggles; 40 px for filter chips and the density switch. The top Proxy switch belongs to the shared
        // workspace header (its own control, not this manager's markup) and is reported, not judged. The icon tools of that header (Export, Tour; ADR-111)
        // are 32 px targets in every window width, so they are judged against 32 (WCAG 2.2 AA asks for 24).
        const needed = element.matches('.workspace-tools .workspace-tool') ? 32 : /filter|chip|density/.test([...element.attributes].map(a => a.name).join(' ')) ? 40 : 44;
        if (Math.min(box.width, box.height) < needed && box.width > 0) found.push({ needed, hook: [...element.attributes].filter(a => a.name.startsWith('data-proxy-')).map(a => a.name).slice(0, 1).join(''), text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 18), w: Math.round(box.width), h: Math.round(box.height) });
      }
      return found;
    });
    evidence.notes.push('touch targets under 44 px at ' + width + ': ' + JSON.stringify(small));
    assert.deepEqual(small.filter(item => item.hook !== 'data-proxy-master'), [], 'every button, menu, toggle and chip meets its touch size at ' + width + ': ' + JSON.stringify(small));
  }
  check('on narrow screens (390 and 699 px) every row action, button, menu and section toggle has a touch target of at least 44 px and every filter chip at least 40 px (the shared top Proxy switch is reported, not judged; the two shared header tools, Export and Tour, keep their 32 px)');
}

async function contrast() {
  if (!wanted('contrast')) return;
  phase = 'contrast';
  await seed({ count: 14 }); await guard(); await ready(14);
  const states = [
    ['list with every chip state', async () => { await opened.evaluate(injectGallery); await pause(600); }],
    ['selection bar', async () => { await opened.click(hook('data-proxy-select', ids[1])); await opened.click(hook('data-proxy-select', ids[2])); await pause(250); }],
    ['details panel', async () => { await opened.click(hook('data-proxy-open', ids[0])); await pause(350); await opened.evaluate(injectGallery); await pause(600); }],
    ['row menu', async () => { await opened.click(hook('data-proxy-more', ids[3])); await pause(250); }],
    ['sheet with errors', async () => { await openSheet(); await opened.click('[data-proxy-save-profile]'); await pause(300); }],
    ['bulk preview', async () => {
      await opened.click(hook('data-proxy-menu', 'add')); await opened.click('[data-proxy-bulk-open]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-bulk]')?.open)), 'bulk dialog');
      await opened.fill('[data-proxy-bulk-text]', ['203.0.113.50:1080 #One', '203.0.113.51:1080:user:pass #Two', 'ftp://203.0.113.9:21', '203.0.113.50:1080 #One again'].join(String.fromCharCode(10))); await opened.click('[data-proxy-bulk-parse]');
      await until(() => opened.evaluate(() => document.querySelector('dialog[data-proxy-bulk]')?.dataset.proxyBulk === 'preview'), 'bulk preview'); await pause(350);
    }],
    ['routing, help and filters', async () => {
      await opened.click(hook('data-proxy-panel', 'routing')); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-panel-body="routing"]'))), 'routing');
      await opened.fill('[data-proxy-domain-input="proxyDomains"]', 'example.com, not a host'); await opened.evaluate(() => { document.querySelector('[data-proxy-domain-input="proxyDomains"]').blur(); return true; });
      await opened.click('[data-proxy-help]'); await opened.click(hook('data-proxy-filter-type', 'socks5')); await pause(300);
    }],
  ];
  const summary = [], failures = [];
  for (const theme of THEMES) {
    const id = theme.startsWith('system') ? 'system' : theme, scheme = DARK_THEMES.has(theme) ? 'dark' : 'light';
    for (const [state, action] of states) {
      await reset(); await arrange({ theme: id, scheme }); await action();
      const result = await opened.evaluate(contrastProbe, {});
      await opened.evaluate(removeGallery);
      summary.push({ theme, state, text: result.seen.text, glyphs: result.seen.glyph, failures: result.failures.length + result.glyphFailures.length });
      for (const failure of [...result.failures, ...result.glyphFailures]) failures.push({ theme, state, ...failure });
    }
    // The row under the pointer and the focused row (Chromium: a real pointer and real keyboard focus).
    if (chrome) {
      await reset(); await arrange({ theme: id, scheme }); await proxyPage().hover(hook('data-proxy-profile', ids[2])); await pause(350);
      for (const [state, scope] of [['hovered row', hook('data-proxy-profile', ids[2])]]) {
        const result = await opened.evaluate(contrastProbe, { scope }); summary.push({ theme, state, text: result.seen.text, glyphs: result.seen.glyph, failures: result.failures.length + result.glyphFailures.length });
        for (const failure of [...result.failures, ...result.glyphFailures]) failures.push({ theme, state, ...failure });
      }
      await opened.evaluate(id => { document.querySelector('[data-proxy-profile="' + id + '"]').focus(); return true; }, ids[2]); await proxyPage().keyboard.press('Shift+Tab'); await proxyPage().keyboard.press('Tab'); await pause(250);
      const ring = await opened.evaluate(() => { const element = document.activeElement, style = getComputedStyle(element); return { visible: element.matches(':focus-visible'), outline: style.outlineColor, width: parseFloat(style.outlineWidth), shadow: style.boxShadow }; });
      assert.equal(ring.visible, true, theme + ': keyboard focus is :focus-visible'); assert.ok(ring.width > 0 || ring.shadow !== 'none', theme + ': the focus ring is drawn ' + JSON.stringify(ring));
    }
  }
  evidence.contrast = summary;
  if (failures.length) {
    const unique = new Map(); for (const failure of failures) { const key = failure.theme + '|' + failure.element + '|' + failure.ratio; if (!unique.has(key)) unique.set(key, failure); }
    const lines = [...unique.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 40).map(failure => failure.theme + ' / ' + failure.state + ': ' + failure.element + ' "' + (failure.text ?? '') + '" ' + failure.ratio + ' (needs ' + (failure.needed ?? 3) + ') fg ' + failure.fg + ' on ' + failure.bg);
    evidence.contrastFailures = [...unique.values()];
    assert.fail(unique.size + ' contrast failures in ' + THEMES.length + ' themes:\n' + lines.join('\n'));
  }
  const checked = summary.reduce((total, row) => total + row.text + row.glyphs, 0);
  check('AA contrast in ' + THEMES.length + ' themes (' + THEMES.join(', ') + '): ' + checked + ' texts and glyphs in ' + summary.length + ' states, including every chip, pill, route state, message, note and stat variant, measured from the computed colors over the real backdrop: text at least 4.5:1, glyphs at least 3:1');
}

async function keyboard() {
  if (!wanted('keyboard')) return;
  phase = 'keyboard-only flow';
  await seed({ count: 14 }); await guard(); await ready(14); await arrange({ scheme: 'light', width: 1280 }); await navigate('?k=' + (++reloads)); await ready(14); await guard();
  if (chrome) await opened.evaluate(() => { globalThis.__puiChecks = { default: { state: 'pass', ms: 140, ip: '203.0.113.9', delay: 450 } }; return true; });
  const page = chrome ? proxyPage() : null;
  const press = async combo => {
    if (chrome) { await page.keyboard.press(combo); return pause(90); }
    const parts = combo.split('+'), key = parts.pop();
    await opened.evaluate(({ key, mods }) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: mods.includes('Control'), shiftKey: mods.includes('Shift'), metaKey: mods.includes('Meta') })); return true; }, { key, mods: parts });
    return pause(90);
  };
  const focused = () => opened.evaluate(() => {
    const element = document.activeElement; if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), row: element.matches('[data-proxy-profile]') ? element.getAttribute('data-proxy-profile') : null, inRow: element.closest('[data-proxy-profile]')?.getAttribute('data-proxy-profile') ?? null, inPeek: Boolean(element.closest('[data-proxy-peek]')), inDialog: Boolean(element.closest('dialog')), hooks: [...element.attributes].filter(attribute => attribute.name.startsWith('data-proxy-')).map(attribute => attribute.name), ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
  });
  const selected = () => opened.evaluate(() => [...document.querySelectorAll('[data-proxy-profile][aria-selected="true"]')].map(row => row.getAttribute('data-proxy-profile')));
  const rowsShown = () => opened.evaluate(() => document.querySelectorAll('[data-proxy-profile]').length);
  const tabUntil = async (predicate, label, limit = 60) => { for (let index = 1; index <= limit; index++) { await press('Tab'); const state = await focused(); if (state && predicate(state)) return { index, state }; } assert.fail('Tab never reached ' + label + ' in ' + limit + ' presses'); };
  const order = await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-profile]')].map(row => row.getAttribute('data-proxy-profile')));
  const stops = [];
  if (chrome) {
    // From a fresh document, Tab reaches the first row, and every stop on the way draws a visible focus ring.
    let reached = null; for (let index = 1; index <= 90 && !reached; index++) { await press('Tab'); const state = await focused(); stops.push(state); if (!state) assert.fail('focus left the document at Tab ' + index); if (state.row) reached = { index, state }; }
    assert.ok(reached, 'Tab reaches the first row'); assert.ok(stops.every(stop => stop.ring), 'every focus stop shows a ring: ' + JSON.stringify(stops.filter(stop => !stop.ring)));
    evidence.timings.tabsToFirstRow = reached.index; assert.equal(reached.state.row, order[0]);
  } else await opened.evaluate(id => { document.querySelector('[data-proxy-profile="' + id + '"]').focus(); return true; }, order[0]);
  // The chip groups and the density switch are toolbars with ONE tab stop each: Tab passes them in one press, the arrows move inside
  // (mirrored right to left), Home and End jump, Space presses the chip that has the focus.
  if (chrome) {
    const stopsOf = hookName => stops.filter(stop => stop.hooks.includes(hookName)).length;
    assert.deepEqual([stopsOf('data-proxy-filter-type'), stopsOf('data-proxy-status-chip'), stopsOf('data-proxy-density-option')], [1, 1, 1], 'each chip group is one tab stop on the way to the first row');
    // ADR-109: while the geolocation notice is shown its link and its dismiss button are two more stops before the list; nothing else is excused.
    const noticeStops = stops.filter(stop => stop.hooks.some(hookName => hookName.startsWith('data-proxy-geo-banner'))).length;
    assert.ok(noticeStops <= 2, 'the notice adds at most its link and its dismiss button: ' + noticeStops);
    // ADR-070: while the companion is not known to be available, its notice adds its download link as one more stop before the list.
    const companionStops = stops.filter(stop => stop.hooks.includes('data-proxy-companion-download')).length;
    assert.ok(companionStops <= 1, 'the companion notice adds at most its link: ' + companionStops);
    assert.ok(evidence.timings.tabsToFirstRow <= 38 + noticeStops + companionStops, 'Tab reaches the first row in at most 38 presses plus the ' + noticeStops + ' of the geolocation notice and the ' + companionStops + ' of the companion notice (it took 45 when every chip was a stop): ' + evidence.timings.tabsToFirstRow);
  }
  const valueAt = itemHook => opened.evaluate(itemHook => document.activeElement?.getAttribute?.(itemHook) ?? null, itemHook);
  const valuesOf = itemHook => opened.evaluate(itemHook => [...document.querySelectorAll('[' + itemHook + ']')].map(button => button.getAttribute(itemHook)), itemHook);
  const stopCount = itemHook => opened.evaluate(itemHook => document.querySelectorAll('[' + itemHook + '][tabindex="0"]').length, itemHook);
  const activate = () => chrome ? press(' ') : opened.evaluate(() => { document.activeElement.click(); return true; }).then(() => pause(90));
  const backTo = async itemHook => { for (let index = 1; index <= 40; index++) { await press('Shift+Tab'); if (await valueAt(itemHook) !== null) return index; } assert.fail('Shift+Tab never reached ' + itemHook); };
  const focusStop = itemHook => opened.evaluate(itemHook => { document.querySelector('[' + itemHook + '][tabindex="0"]').focus(); return true; }, itemHook);
  async function exercise(itemHook, { rtl = false, reach, toggled = null }) {
    const names = await valuesOf(itemHook), forward = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft', label = itemHook + (rtl ? ' (right to left)' : '');
    await reach(itemHook); const start = names.indexOf(await valueAt(itemHook)); assert.ok(start >= 0, label + ': the focus is on the group stop'); assert.equal(await stopCount(itemHook), 1, label + ': one tab stop');
    await press(forward); assert.equal(await valueAt(itemHook), names[(start + 1) % names.length], label + ': forward'); await press(back); assert.equal(await valueAt(itemHook), names[start], label + ': back');
    await press('End'); assert.equal(await valueAt(itemHook), names.at(-1), label + ': End'); await press(forward); assert.equal(await valueAt(itemHook), names[0], label + ': forward from the last wraps');
    await press('Home'); assert.equal(await valueAt(itemHook), names[0], label + ': Home'); await press(back); assert.equal(await valueAt(itemHook), names.at(-1), label + ': back from the first wraps');
    assert.equal(await stopCount(itemHook), 1, label + ': still one tab stop, now the chip that has the focus');
    if (toggled) { const expected = await opened.evaluate(() => Number(document.activeElement.querySelector('.pm-chip-count')?.textContent ?? NaN)); await activate(); await toggled.during(expected); await press('Home'); await activate(); await toggled.after(); }
    if (chrome && !rtl) { await press('Tab'); assert.equal(await valueAt(itemHook), null, label + ': Tab leaves the group in one press'); }
  }
  const reachGroup = chrome ? backTo : focusStop;
  await exercise('data-proxy-density-option', { reach: reachGroup, toggled: { during: async () => assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-density]').getAttribute('data-proxy-density')), 'compact', 'Space on a chip presses it'), after: async () => assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-density]').getAttribute('data-proxy-density')), 'comfortable') } });
  await exercise('data-proxy-status-chip', { reach: reachGroup, toggled: { during: async expected => assert.equal(await rowsShown(), expected, 'the chip filters the list to the count it shows'), after: async () => assert.equal(await rowsShown(), 14, 'All brings the list back') } });
  await exercise('data-proxy-filter-type', { reach: reachGroup, toggled: { during: async expected => assert.equal(await rowsShown(), expected, 'the last kind filters the list to the count it shows'), after: async () => assert.equal(await rowsShown(), 14) } });
  // Right to left: the same keys, mirrored (Left is forward in Arabic).
  await arrange({ scheme: 'light', width: 1280, language: 'ar' });
  await exercise('data-proxy-filter-type', { rtl: true, reach: focusStop }); await exercise('data-proxy-density-option', { rtl: true, reach: focusStop });
  await arrange({ scheme: 'light', width: 1280, language: 'en' });
  // The skip link: the first stop of the section (it shows itself when it has the focus); Enter on it lands on the row Tab would reach.
  await navigate('?s=' + (++reloads)); await ready(14); await guard();
  if (chrome) {
    let skip = null; for (let index = 1; index <= 60 && !skip; index++) { await press('Tab'); const state = await focused(); if (!state) assert.fail('focus left the document at Tab ' + index); if (state.hooks.includes('data-proxy-skip')) skip = { index, state }; }
    assert.ok(skip, 'Tab reaches the skip link'); assert.equal(skip.state.ring, true, 'the skip link draws a focus ring'); evidence.timings.tabsToSkipLink = skip.index; assert.ok(skip.index < evidence.timings.tabsToFirstRow, 'the skip link comes well before the rows');
    const box = await opened.evaluate(() => { const rect = document.activeElement.getBoundingClientRect(); return { width: Math.round(rect.width), height: Math.round(rect.height) }; }); assert.ok(box.width > 80 && box.height >= 24, 'the skip link shows itself when it has the focus: ' + JSON.stringify(box));
    await shot('skip-link-1280', { keepFocus: true, viewport: true });
    await press('Enter'); assert.equal((await focused()).row, order[0], 'Enter on the skip link lands on the first row');
    assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-skip]').getBoundingClientRect().width <= 2), true, 'and the skip link hides itself again');
  } else { await opened.evaluate(() => { const skip = document.querySelector('[data-proxy-skip]'); skip.focus(); skip.click(); return true; }); await pause(150); assert.equal((await focused()).row, order[0], 'the skip link lands on the first row'); }
  await press('ArrowDown'); assert.equal((await focused()).row, order[1], 'ArrowDown moves to the next row');
  await press('End'); assert.equal((await focused()).row, order.at(-1)); await press('Home'); assert.equal((await focused()).row, order[0]); await press('ArrowDown');
  await press(' '); assert.deepEqual(await selected(), [order[1]], 'Space selects the row');
  await press('Shift+ArrowDown'); await press('Shift+ArrowDown'); assert.deepEqual(await selected(), [order[1], order[2], order[3]], 'Shift+Arrow extends the selection');
  await press('Control+a'); assert.equal((await selected()).length, 14, 'Ctrl+A selects every row');
  await press('Escape'); assert.deepEqual(await selected(), [], 'Escape clears the selection first');
  const current = (await focused()).row ?? (await focused()).inRow; await press('Enter');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-peek]'))), 'details opened by Enter'); await pause(250);
  assert.equal((await focused())?.inPeek, true, 'focus moves into the details panel');
  await press('Escape'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-peek]')), 'details closed by Escape'); await pause(250);
  assert.equal((await focused())?.row, current, 'focus returns to the row that opened the details');
  await press('/'); assert.ok((await focused())?.hooks.includes('data-proxy-search'), '/ focuses the search field');
  if (chrome) await page.keyboard.type('frank'); else await opened.fill('[data-proxy-search]', 'frank');
  await until(async () => (await rowsShown()) === 1, 'search narrows the list'); if (chrome) { await press('Control+a'); await press('Backspace'); } else await opened.fill('[data-proxy-search]', '');
  await until(async () => (await rowsShown()) === 14, 'search cleared');
  if (chrome) {
    await tabUntil(state => state.row, 'a row again');
    const checkedRow = (await focused()).row; await press('c');
    await until(() => opened.evaluate(id => document.querySelector('[data-proxy-health="' + id + '"]')?.dataset.state === 'checking', checkedRow), 'C starts a check on the focused row'); await until(() => opened.evaluate(id => document.querySelector('[data-proxy-health="' + id + '"]')?.dataset.state === 'pass', checkedRow), 'the check settles', 15000);
    await press('Delete'); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-removal]'))), 'Delete asks first');
    assert.ok((await focused())?.hooks.includes('data-proxy-remove-cancel'), 'focus moves to the safe choice of the confirmation'); await press('Enter');
    await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-removal]')), 'confirmation cancelled'); await until(async () => (await focused())?.row === checkedRow, 'focus returns to the row after Cancel', 8000);
    assert.equal(await rowsShown(), 14, 'nothing was deleted');
    const more = await tabUntil(state => state.hooks.includes('data-proxy-more'), 'the row menu button', 14); assert.equal(more.state.inRow, checkedRow);
    await press('Enter'); await until(() => opened.evaluate(() => Boolean(document.querySelector('.pm-menu'))), 'menu opens'); assert.equal((await focused())?.role, 'menuitem', 'the first menu item takes focus');
    await press('ArrowDown'); assert.equal((await focused())?.role, 'menuitem'); await press('Escape');
    await until(() => opened.evaluate(() => !document.querySelector('.pm-menu')), 'menu closes'); await until(async () => (await focused())?.hooks.includes('data-proxy-more') === true, 'focus returns to the menu button', 8000);
  }
  await opened.evaluate(() => { document.querySelector('[data-proxy-new]').focus(); return true; }); if (chrome) await press('Enter'); else await opened.evaluate(() => { document.querySelector('[data-proxy-new]').click(); return true; });
  await until(() => opened.evaluate(() => Boolean(document.querySelector('dialog[data-proxy-editor]')?.open)), 'sheet opens'); assert.equal((await focused())?.inDialog, true, 'focus moves into the sheet');
  if (chrome) { const visited = new Set(); for (let index = 0; index < 40; index++) { await press('Tab'); const state = await focused(); assert.ok(state === null || state.inDialog, 'Tab never reaches the page behind the sheet (press ' + (index + 1) + '): ' + JSON.stringify(state)); if (state) visited.add(state.hooks.join(',') + state.tag); } assert.ok(visited.size >= 8, 'Tab walks through the sheet controls (' + visited.size + ' different stops)'); }
  if (chrome) await press('Escape'); else await opened.evaluate(() => { document.querySelector('dialog[data-proxy-editor]').dispatchEvent(new Event('cancel', { cancelable: true })); return true; });
  await until(() => opened.evaluate(() => !document.querySelector('dialog[data-proxy-editor]')), 'sheet closes'); await until(async () => (await focused())?.hooks.includes('data-proxy-new') === true, 'focus returns to the Add button', 8000);
  check('keyboard-only (' + (chrome ? 'real key presses' : 'key events on the focused element') + '): ' + (chrome ? 'Tab reaches the first row in ' + evidence.timings.tabsToFirstRow + ' presses (the skip link in ' + evidence.timings.tabsToSkipLink + ') with a visible ring on every stop; ' : '') + 'the type chips, status chips and density switch are one tab stop each with arrows, Home, End and Space (mirrored in Arabic); ' + 'arrows, Home, End, Space, Shift+arrows, Ctrl+A, Escape, Enter, / and ' + (chrome ? 'C, Delete (focus on the safe choice), the row menu and ' : '') + 'the Add sheet work, and focus always lands somewhere sensible');
}

async function motion() {
  if (!wanted('motion') || !chrome) return;
  phase = 'motion';
  await seed({ count: 14 }); await guard(); await ready(14);
  const measure = () => opened.evaluate(() => {
    const seconds = text => Math.max(...String(text).split(',').map(part => part.trim().endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part)));
    const of = selector => { const element = document.querySelector(selector); if (!element) return null; const style = getComputedStyle(element); return { transition: seconds(style.transitionDuration), animation: style.animationName === 'none' ? 0 : seconds(style.animationDuration) }; };
    return { row: of('[data-proxy-profile]'), chip: of('.pm-chip'), button: of('.button'), peek: of('[data-proxy-peek]'), bar: of('.pm-bar'), spinner: of('.pm-spinner') };
  });
  await arrange({ reduced: 'no-preference' }); await opened.click(hook('data-proxy-open', ids[0])); await pause(500);
  const normal = await measure();
  for (const key of ['row', 'chip', 'button']) assert.ok(normal[key].transition >= 0.1 && normal[key].transition <= 0.2, key + ' transitions take 100-200 ms: ' + JSON.stringify(normal[key]));
  assert.ok(normal.peek.animation <= 0.2, 'the panel slides in at most 200 ms');
  await arrange({ reduced: 'reduce' }); await pause(300);
  const reduced = await measure();
  for (const [key, value] of Object.entries(reduced)) if (value) assert.deepEqual([value.transition, value.animation], [0, 0], key + ' does not move under prefers-reduced-motion: ' + JSON.stringify(value));
  await arrange({ reduced: 'no-preference' });
  evidence.timings.motion = { normal, reduced };
  check('motion takes 100-200 ms (rows, chips, buttons, the panel) and none at all under prefers-reduced-motion');
}

async function forced() {
  if (!wanted('forced') || !chrome) return;
  phase = 'forced colors';
  await seed({ count: 14 }); await guard(); await ready(14); await arrange({ forced: 'active', scheme: 'light' }); await opened.click(hook('data-proxy-select', ids[1])); await pause(300);
  const probe = await opened.evaluate(() => {
    const border = selector => { const element = document.querySelector(selector); if (!element) return null; const style = getComputedStyle(element); return { width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor, forced: matchMedia('(forced-colors: active)').matches }; };
    return { pill: border('.pm-pill'), chip: border('.pm-chip'), button: border('[data-proxy-new]'), bar: border('.pm-bar'), row: (() => { const row = document.querySelector('[data-proxy-profile][aria-selected="true"]'), style = getComputedStyle(row); return { outline: style.outlineStyle, border: parseFloat(style.borderInlineStartWidth), shadow: style.boxShadow, background: style.backgroundColor }; })() };
  });
  for (const key of ['pill', 'chip', 'button', 'bar']) { assert.equal(probe[key].forced, true); assert.ok(probe[key].width > 0 && probe[key].style !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(probe[key].color), key + ' keeps a visible border in forced colors: ' + JSON.stringify(probe[key])); }
  await arrange({ forced: 'none', scheme: 'light' });
  check('forced colors: pills, chips, buttons and the selection bar keep a visible system-color border, so state never depends on color alone');
}

async function speed() {
  if (!wanted('performance')) return;
  phase = 'performance with 100 profiles';
  await seed({ count: 100 }); await ready(100); const started = Date.now(); await navigate('?p=' + (++reloads)); await ready(100); const renderMs = Date.now() - started; await guard();
  await arrange({ scheme: 'light' });
  const timings = await opened.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const longTasks = []; try { new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask' }); } catch { /* not supported here */ }
    const timed = async action => { await frame(); const start = performance.now(); action(); await frame(); return Math.round(performance.now() - start); };
    const search = document.querySelector('[data-proxy-search]'), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const type = value => { setter.call(search, value); search.dispatchEvent(new Event('input', { bubbles: true })); };
    const result = { rows: document.querySelectorAll('[data-proxy-profile]').length, nodes: document.querySelectorAll('*').length, filter: [], sort: [] };
    for (const value of ['a', 'ab', 'abc', '2', '']) result.filter.push(await timed(() => type(value)));
    for (const column of ['host', 'latency', 'checked', 'name']) result.sort.push(await timed(() => document.querySelector('[data-proxy-sort-column="' + column + '"]').click()));
    result.selectAll = await timed(() => document.querySelector('[data-proxy-select-all]').click()); result.clearAll = await timed(() => document.querySelector('[data-proxy-select-all]').click());
    result.chipFilter = await timed(() => document.querySelector('[data-proxy-filter-type="http"]').click()); result.chipReset = await timed(() => document.querySelector('[data-proxy-filter-type="http"]').click());
    result.longTasks = longTasks; return result;
  });
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)], worst = Math.max(...timings.filter, ...timings.sort, timings.selectAll, timings.clearAll, timings.chipFilter, timings.chipReset);
  evidence.timings.performance = { renderMs, ...timings, filterMedian: median(timings.filter), worst };
  console.log('  performance: 100 profiles ready in ' + renderMs + ' ms after navigation; filter median ' + median(timings.filter) + ' ms; slowest interaction ' + worst + ' ms; ' + timings.nodes + ' DOM nodes; long tasks ' + JSON.stringify(timings.longTasks));
  assert.equal(timings.rows, 100); assert.ok(renderMs < 5000, 'first render of 100 profiles ' + renderMs + ' ms');
  assert.ok(median(timings.filter) < 160, 'typing in the search stays smooth (median ' + median(timings.filter) + ' ms)'); assert.ok(worst < 400, 'no interaction takes 400 ms (' + worst + ')'); assert.ok(timings.longTasks.every(duration => duration < 250), 'no long task of 250 ms or more: ' + JSON.stringify(timings.longTasks));
  check('100 profiles: ready ' + renderMs + ' ms after navigation, typing a filter takes ' + median(timings.filter) + ' ms (median) and the slowest of 15 interactions ' + worst + ' ms, ' + timings.nodes + ' DOM nodes, ' + timings.longTasks.length + ' long tasks');
}

// ---- The companion download notice (ADR-070, UI only) ----------------------------------------------------------------------------------
// Shown while the companion is not known to be available. This browser has none, so the notice is on the page in every scene above and
// those suites already measure it; this phase judges it on its own and says what it measured: AA contrast of its three texts and two
// glyphs in all themes (and, in Chromium, high contrast and forced colors), the link as a 44 px target on a phone, the card in all 21
// languages at 340 px, and (Chromium) that it goes away once the service reports a companion (a faked answer to the check; nothing real
// is asked and nothing leaves the browser).
function noticeProbe() {
  const notice = document.querySelector('[data-proxy-companion-notice]'), link = notice?.querySelector('a[data-proxy-companion-download="notice"]');
  if (!notice || !link) return null;
  const frame = notice.getBoundingClientRect(), style = getComputedStyle(notice), parts = { title: notice.querySelector('.pm-companion-notice-title'), body: notice.querySelector('.pm-banner-text'), link };
  return { width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, left: frame.left, right: frame.right, direction: style.direction, border: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor, linkHeight: link.getBoundingClientRect().height,
    clipped: Object.entries(parts).filter(([, element]) => element.scrollWidth > element.clientWidth + 1).map(([name]) => name),
    outside: Object.entries({ icon: notice.querySelector('svg'), ...parts }).filter(([, element]) => { const rect = element.getBoundingClientRect(); return rect.left < frame.left - 1 || rect.right > frame.right + 1; }).map(([name]) => name),
    unresolved: /proxy_workspace_|browser_debug_|[{][a-z]+[}]/.test(notice.textContent) };
}
async function companionNotice() {
  if (!wanted('companion') && !wanted('companion-hide')) return;
  phase = 'companion notice';
  await seed({ count: 3 }); await guard(); await ready(3);
  const scope = '[data-proxy-companion-notice]', summary = [], failures = [];
  const measure = async label => {
    const result = await opened.evaluate(contrastProbe, { scope });
    assert.deepEqual([result.seen.text, result.seen.glyph], [3, 2], label + ': the probe measured the card (its heading, text and link label, and its warning and arrow glyphs)');
    summary.push({ label, text: result.seen.text, glyphs: result.seen.glyph, failures: result.failures.length + result.glyphFailures.length });
    for (const failure of [...result.failures, ...result.glyphFailures]) failures.push({ label, ...failure });
  };
  if (wanted('companion')) {
    for (const theme of THEMES) {
      const id = theme.startsWith('system') ? 'system' : theme, scheme = DARK_THEMES.has(theme) ? 'dark' : 'light';
      for (const language of ['en', 'ru', 'ar', 'de']) for (const width of [1280, 390, 340]) { await reset(); await arrange({ theme: id, scheme, language, width }); await measure(theme + '/' + language + '/' + width); }
    }
    if (chrome) for (const scheme of ['light', 'dark']) for (const [name, options] of [['high contrast', { contrast: 'more' }], ['forced colors', { forced: 'active' }]]) {
      for (const width of [1280, 340]) {
        await reset(); await arrange({ scheme, width, ...options }); await measure(name + '/' + scheme + '/' + width);
        if (options.forced) { const m = await opened.evaluate(noticeProbe); assert.ok(m.border > 0 && m.borderColor !== 'rgba(0, 0, 0, 0)', 'forced colors keep a visible border on the card ' + JSON.stringify([m.border, m.borderColor])); }
      }
    }
    evidence.contrastNotice = summary;
    if (failures.length) { evidence.contrastNoticeFailures = failures; assert.fail(failures.length + ' contrast failures in the companion notice:\n' + failures.slice(0, 20).map(failure => failure.label + ': ' + failure.element + ' "' + (failure.text ?? '') + '" ' + failure.ratio + ' (needs ' + (failure.needed ?? 3) + ') fg ' + failure.fg + ' on ' + failure.bg).join('\n')); }
    check('AA contrast of the companion notice (its 3 texts and 2 glyphs) in ' + THEMES.length + ' themes and 4 languages at 1280/390/340 px' + (chrome ? ', in high contrast and in forced colors' : '') + ': text at least 4.5:1, glyphs at least 3:1, measured in ' + summary.length + ' scenes');

    // Touch target and 21 languages at 340 px.
    const found = {};
    for (const language of PRODUCTION_LANGUAGES) {
      await reset(); await arrange({ width: 340, language: language.id, scheme: 'dark' });
      const m = await opened.evaluate(noticeProbe); assert.ok(m, language.id + ': the notice is on the page');
      assert.ok(m.overflow <= 0, language.id + ': no horizontal scroll (' + m.overflow + ')'); assert.deepEqual(m.clipped, [], language.id + ': no clipped text'); assert.deepEqual(m.outside, [], language.id + ': nothing outside the card');
      assert.equal(m.unresolved, false, language.id + ': no key or placeholder shows'); assert.ok(m.left >= -1 && m.right <= m.width + 1, language.id + ': the card fits the window');
      assert.equal(m.direction, ['ar', 'ur'].includes(language.id) ? 'rtl' : 'ltr', language.id); assert.ok(m.linkHeight >= 43.5, language.id + ': a 44 px link on a phone-sized window (' + Math.round(m.linkHeight) + ')');
      found[language.id] = { height: Math.round(m.linkHeight), overflow: m.overflow };
      await measure(language.id + '/340');
      if (['de', 'ar', 'ur', 'ja', 'ru', 'ta'].includes(language.id)) await shot('companion-notice-' + language.id + '-340', { viewport: true, from: scope });
    }
    evidence.noticeLanguages = found;
    if (failures.length) { evidence.contrastNoticeFailures = failures; assert.fail(failures.length + ' contrast failures in the companion notice in the 21 languages'); }
    check('in all 21 languages the companion notice at 340 px has no horizontal scroll, no clipped text, nothing outside its card, no unresolved key, the right direction, a 44 px link and AA contrast');
    await reset(); await arrange({ width: 1280, language: 'en', scheme: 'light' }); await shot('companion-notice-en-1280', { viewport: true, from: scope });
  }
  // It goes away when the service reports a companion (Chromium: a faked answer to the check).
  if (chrome) {
    await opened.evaluate(() => { localStorage.setItem('__puiHost', '1'); return true; });
    try {
      await reset(); await arrange({ width: 1280, language: 'en', scheme: 'light' });
      const count = () => opened.evaluate(() => document.querySelectorAll('[data-proxy-companion-notice]').length);
      assert.equal(await count(), 1, 'shown before the companion is found');
      await opened.click(hook('data-proxy-panel', 'companion')); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-panel-body="companion"]'))), 'Companion section');
      await opened.click('[data-proxy-companion-check]');
      await until(() => opened.evaluate(() => document.querySelector('[data-proxy-companion-status]')?.getAttribute('data-proxy-companion-status') === 'available'), 'companion reported available');
      assert.equal(await count(), 0, 'gone once the companion is reported');
      assert.equal(await opened.evaluate(() => document.querySelectorAll('a[data-proxy-companion-download="notice"]').length), 0);
      assert.equal(await opened.evaluate(() => document.querySelectorAll('[data-proxy-panel-body="companion"] a[data-proxy-companion-download="panel"]').length), 1, 'the section keeps its own link');
    } finally { await opened.evaluate(() => { localStorage.removeItem('__puiHost'); return true; }); }
    await seed({ count: 3 }); await guard(); await ready(3);
    assert.equal(await opened.evaluate(() => document.querySelectorAll('[data-proxy-companion-notice]').length), 1, 'a fresh page that does not know the companion shows the notice again (nothing was stored)');
    check('the notice is gone as soon as the service reports an available companion, the Companion section keeps its link, and a fresh page shows the notice again because nothing was remembered');
  }
}
async function languages() {
  if (!wanted('languages')) return;
  phase = '21 languages on a narrow screen';
  await seed({ count: 14 }); await guard(); await ready(14);
  const clippedChips = {};
  for (const language of PRODUCTION_LANGUAGES) {
    await reset(); await arrange({ width: 390, language: language.id, scheme: 'dark' });
    // The skip link shows itself on focus inside the window, without covering the title or the shared switch (the title is always "Proxy").
    const pill = await opened.evaluate(() => { const skip = document.querySelector('[data-proxy-skip]'); skip.focus(); const box = skip.getBoundingClientRect(), round = rect => [rect.left, rect.top, rect.right, rect.bottom].map(Math.round), extent = element => { if (element.tagName !== 'H2') return element.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); }, covered = [...document.querySelectorAll('.pm-master h2, .pm-master .workspace-master-toggle')].filter(element => element.getClientRects().length).filter(element => { const rect = extent(element); return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top; }).map(element => ({ element: element.tagName.toLowerCase() + '.' + element.className, box: round(extent(element)), skip: round(box) })); return { inside: box.left >= 0 && box.right <= innerWidth, wide: box.width > 80, covered }; });
    assert.deepEqual(pill, { inside: true, wide: true, covered: [] }, language.id + ': the skip link shows itself inside the window without covering the title or the shared switch');
    if (chrome && language.id === 'ar') await shot('skip-link-ar-390', { keepFocus: true, viewport: true });
    await opened.evaluate(() => { document.activeElement?.blur?.(); return true; });
    await opened.click(hook('data-proxy-open', ids[0])); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-peek]'))), 'details in ' + language.id); await pause(300);
    const probe = await opened.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, direction: getComputedStyle(document.querySelector('[data-proxy-workspace]')).direction, unresolved: /proxy_workspace_|browser_debug_|[{](shown|total|done|passed|failed|count|name|time|session)[}]/.test(document.querySelector('[data-proxy-workspace]').textContent),
      clipped: [...document.querySelectorAll('[data-proxy-workspace] .pm-chip, [data-proxy-workspace] .pm-pill, [data-proxy-workspace] .pm-state, [data-proxy-workspace] .pm-route-tag')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow !== 'visible').map(element => element.textContent.trim().slice(0, 24)) }));
    assert.ok(probe.overflow <= 0, language.id + ': no horizontal scroll (' + probe.overflow + ')'); assert.equal(probe.direction, ['ar', 'ur'].includes(language.id) ? 'rtl' : 'ltr', language.id); assert.equal(probe.unresolved, false, language.id + ': no key or placeholder shows');
    if (probe.clipped.length) clippedChips[language.id] = probe.clipped;
    if (['de', 'ar', 'ja'].includes(language.id)) await shot('lang-' + language.id + '-390');
    await harvest();
  }
  evidence.clippedChips = clippedChips;
  assert.deepEqual(clippedChips, {}, 'no chip or pill clips its label in any language: ' + JSON.stringify(clippedChips));
  check('in all 21 languages the details panel on a 390 px screen has no horizontal scroll, no unresolved key or placeholder, the right direction (right to left only for Arabic and Urdu), no chip that clips its label and a skip link that shows itself without covering the title or the shared switch');
}

// ---- Run ---------------------------------------------------------------------------------------------------------------------------------
try {
  opened = await launchOwnedManagement({ root, run, extension: frozen, browser, evidence, dark: !chrome });
  evidence.version = opened.version;
  if (chrome) {
    await opened.context.addInitScript(FAKE_SERVICE);
    opened.context.on('console', message => { if (message.type() === 'error') problems.push('console error: ' + message.text().slice(0, 300)); });
    opened.context.on('weberror', error => problems.push('page error: ' + String(error.error()?.message ?? error.error()).slice(0, 300)));
  }
  await opened.goto(opened.base + 'options.html#proxy'); await ready();
  await screens(); await layout(); await overflow(); await targets(); await contrast(); await companionNotice(); await keyboard(); await motion(); await forced(); await speed(); await languages();
  await harvest();
  assert.deepEqual(problems, [], 'no console error or uncaught exception during the whole run');
  check('no console error, uncaught exception or unhandled rejection was reported on the Proxy page during the whole run');
  evidence.result = 'PASS'; console.log('PASS Proxy UI visual ' + browser + ': ' + evidence.checks.length + ' checks, ' + evidence.screenshots.length + ' screenshots in ' + shots);
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = error.message; evidence.problems = problems; if (opened) try { await opened.screenshot(join(run, 'failed.png')); } catch { /* nothing to show */ } throw error; }
finally {
  try { if (opened) await opened.close(); } finally { const output = privateRun ? join(run, 'ui-visual-' + browser + '.json') : join(root, 'test-results/production-2.0.0/proxy/ui-visual-' + browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
}
