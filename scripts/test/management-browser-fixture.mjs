// Owned disposable management browser helper. No existing user profile is opened or modified.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(probe, label, timeout = 20000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }
export async function launchOwnedManagement({ root, run, extension, browser, evidence, dark = false, loopbackHosts = [], downloadDirectory = null, headless = true, acceptInsecureCerts = false, userScripts = true }) {
  assert.ok(Array.isArray(loopbackHosts) && loopbackHosts.length <= 8 && loopbackHosts.every(host => /^[a-z0-9.-]+\.example\.(com|net)$/.test(host)), 'Only owned example hostnames may map to loopback');
  const profile = join(run, browser + '-profile'); mkdirSync(profile, { recursive: true });
  if (downloadDirectory !== null) { assert.equal(typeof downloadDirectory, 'string'); mkdirSync(downloadDirectory, { recursive: true }); }
  if (browser === 'chrome') {
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run', ...(loopbackHosts.length ? ['--no-proxy-server', '--host-resolver-rules=' + loopbackHosts.map(host => 'MAP ' + host + ' 127.0.0.1').join(', ')] : [])] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const base = new URL('.', worker.url()).href;
      let page = await context.newPage(); await page.goto(base + 'options.html#settings'); if (userScripts) page = await enableChromeUserScripts(context, page, new URL(base).host, evidence);
      return { context, version: context.browser().version(), base, flipUserScripts: async () => { page = await enableChromeUserScripts(context, page, new URL(base).host, evidence); }, bringToFront: () => page.bringToFront(), dispatchFocus: () => page.evaluate(() => window.dispatchEvent(new Event('focus'))), evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), fill: (selector, value) => page.locator(selector).fill(value),
        screenshot: path => page.screenshot({ path, fullPage: true }), viewport: (width, height) => page.setViewportSize({ width, height }), media: options => page.emulateMedia(options), close: () => context.close() };
    } catch (error) { await context.close(); throw error; }
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0, 'ui.systemUsesDarkTheme': dark ? 1 : 0, 'layout.css.prefers-color-scheme.content-override': dark ? 0 : 1 };
  if (downloadDirectory !== null) Object.assign(prefs, { 'browser.download.folderList': 2, 'browser.download.dir': downloadDirectory, 'browser.download.useDownloadDir': true,
    'browser.helperApps.neverAsk.saveToDisk': 'application/json,text/plain,application/octet-stream', 'browser.download.alwaysOpenPanel': false });
  if (loopbackHosts.length) prefs['network.dns.localDomains'] = loopbackHosts.join(',');
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const ports = createServer(); await new Promise(resolve => ports.listen(0, '127.0.0.1', resolve)); const port = ports.address().port; await new Promise(resolve => ports.close(resolve));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, 'geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const result = (await response.json()).value; if (!response.ok || result?.error) throw Error(result?.error ?? 'WebDriver error'); return result; }
  let session;
  try {
    await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'owned geckodriver');
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: acceptInsecureCerts === true, 'moz:firefoxOptions': { binary, args: [...(headless ? ['-headless'] : []), '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method), xpi = join(run, 'owned.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
    const element = async selector => (await wd('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/',
      evaluate: async (fn, value) => { const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!result.ok) throw Error(result.error); return result.value; },
      goto: url => wd('/url', { url }), click: async selector => { await until(async () => { try { return await wd('/execute/sync', { script: 'const e=document.querySelector(arguments[0]);return Boolean(e&&!e.disabled&&e.getClientRects().length);', args: [selector] }); } catch { return false; } }, 'clickable ' + selector); await wd('/execute/sync', { script: 'document.querySelector(arguments[0]).scrollIntoView({block:"center"});', args: [selector] }); return wd('/element/' + await element(selector) + '/click', {}); },
      fill: async (selector, value) => {
        const id = await element(selector);
        // Firefox ElementClear does not emit the user's input event. Use real
        // keys for empty edits so controlled inputs receive the deletion.
        if (value === '') { const keys = '\uE009a\uE000\uE003'; return wd('/element/' + id + '/value', { text: keys, value: [...keys] }); }
        await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text: value, value: [...value] });
      },
      screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')),
      viewport: async (width, height) => {
        // Firefox's outer window includes native browser/sidebar chrome. Match
        // the requested content viewport, including the native minimum width.
        let outerWidth = width, outerHeight = height;
        for (let attempt = 0; attempt < 3; attempt++) {
          await wd('/window/rect', { width: outerWidth, height: outerHeight });
          const actual = await wd('/execute/sync', { script: 'return {innerWidth,innerHeight,outerWidth,outerHeight};', args: [] });
          if (actual.innerWidth === width && actual.innerHeight === height) return;
          outerWidth = width + actual.outerWidth - actual.innerWidth;
          outerHeight = height + actual.outerHeight - actual.innerHeight;
        }
        throw Error('Native Firefox viewport cannot match the requested content size');
      }, media: async () => {},
      close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}
